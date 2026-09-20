import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PERSON_SEQUENCE_SCOPE,
  assertLinkTarget,
  formatUzaId,
  normaliseExternalId,
  normaliseSystem,
  normaliseUzaId,
  parseUzaId,
} from './uza-identity.rules';

/**
 * One person, one permanent public identifier, resolvable from any UZA system.
 *
 * The schema for this landed in August (`20260822100000_uza_identity`) and nothing in
 * `src/` has used it since: `users.uzaId` was read in five places, `id_sequences` was
 * written only by `prisma/seed-tunga-candidates.ts`, and `identity_links` was written by
 * nobody at all. This is the service that makes the identity layer real — the garage, the
 * academy, the allocation desk and anything built later ask this one class, rather than
 * each growing its own idea of who a person is.
 *
 * ── Allocation ───────────────────────────────────────────────────────────────────────────
 *
 * `UPDATE ... RETURNING` on `id_sequences`, never read-then-write. The update takes a row
 * lock, so two concurrent registrations cannot be handed the same number. A gap in the
 * sequence is harmless; a reused identifier is not. This is the same statement
 * `prisma/seed-tunga-candidates.ts` runs, deliberately — the seed and the application must
 * not disagree about how a number is issued.
 *
 * The year comes from the person's `createdAt`, not from today. The migration's backfill
 * partitions by `EXTRACT(YEAR FROM "createdAt")`, so allocating against the current year
 * for an account opened in 2025 would put a 2026 identifier on a 2025 row and break the
 * property that makes the backfill safe to re-run against a restored snapshot.
 *
 * ── What this service does NOT do ────────────────────────────────────────────────────────
 *
 * It does not make `users.uzaId` NOT NULL. The migration says in its own words that this is
 * a second, separate deploy run only after its verification queries come back clean, and
 * that decision belongs to whoever runs it against production — not to application code.
 */
@Injectable()
export class UzaIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** The fields any consumer of an identity needs, and nothing more. */
  private static readonly PERSON_SELECT = {
    id: true,
    uzaId: true,
    firstName: true,
    lastName: true,
    phone: true,
    isActive: true,
    createdAt: true,
  } as const;

  /**
   * The next person identifier for a given year, inside the caller's transaction.
   *
   * `ON CONFLICT ... DO UPDATE ... RETURNING` is one statement: the row is created at 1 the
   * first time a year is used and incremented under a lock every time after.
   */
  private async allocate(
    tx: Prisma.TransactionClient,
    year: number,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "id_sequences" ("id", "scope", "year", "lastValue", "updatedAt")
      VALUES (${`seq_person_${year}`}, ${PERSON_SEQUENCE_SCOPE}, ${year}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("scope", "year")
      DO UPDATE SET "lastValue" = "id_sequences"."lastValue" + 1,
                    "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "lastValue"
    `;
    return formatUzaId(year, rows[0].lastValue);
  }

  /**
   * The person's permanent identifier, issuing one if they do not have it yet.
   *
   * Idempotent: an account that already carries a UZA ID gets that one back and the
   * allocator is not touched. `allocated` says which of the two happened, because "we just
   * gave this person their number" is a different event from "we looked it up" and the
   * activity log should be able to tell them apart.
   */
  async ensureForUser(
    userId: string,
    actorUserId?: string,
    auditContext: RequestAuditContext = {},
  ): Promise<{ uzaId: string; allocated: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, uzaId: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('No such user.');
    if (user.uzaId) return { uzaId: user.uzaId, allocated: false };

    const year = user.createdAt.getUTCFullYear();
    const uzaId = await this.prisma.$transaction(async (tx) => {
      const issued = await this.allocate(tx, year);
      await tx.user.update({ where: { id: user.id }, data: { uzaId: issued } });
      return issued;
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'identity:uza-id-allocated',
      entity: 'User',
      entityId: user.id,
      metadata: { uzaId, year },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return { uzaId, allocated: true };
  }

  /** The person behind an identifier, or null. Validates the format before querying. */
  async findPerson(rawUzaId: string) {
    const uzaId = normaliseUzaId(rawUzaId);
    parseUzaId(uzaId);
    return this.prisma.user.findUnique({
      where: { uzaId },
      select: UzaIdentityService.PERSON_SELECT,
    });
  }

  /**
   * The person behind an identifier, or a 404.
   *
   * Every module that addresses people by UZA ID — the academy, the allocation desk, the
   * candidate journey — needs this same lookup and the same sentence when it misses.
   */
  async requirePerson(rawUzaId: string) {
    const person = await this.findPerson(rawUzaId);
    // The lookup was BY `uzaId`, so a row can only come back with one set. Re-stating it
    // narrows the nullable column for every caller, which is why this returns a widened
    // object rather than the row: the alternative is a non-null assertion at each use.
    if (!person?.uzaId) {
      throw new NotFoundException('No participant with that UZA ID.');
    }
    return { ...person, uzaId: person.uzaId };
  }

  /**
   * The identifier for an internal user id, without issuing one.
   *
   * This is the read helper the garage uses. It deliberately does not allocate: a mechanic
   * opening a job card should discover that a customer has no UZA ID, not silently create
   * one for a walk-in who is not in the programme. `null` is the honest answer there.
   */
  async uzaIdForUser(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { uzaId: true },
    });
    return user?.uzaId ?? null;
  }

  /**
   * The person another system is holding, by that system's own key.
   *
   * This is the question `identity_links` exists to answer: uza-charge has a driver id, the
   * garage has a customer record, Nexus has a contact — each asks once, with its own key,
   * and gets back the same person. Returns null rather than throwing, because "we have
   * never seen this key" is an ordinary answer at a charge point.
   */
  async resolve(rawSystem: string, rawExternalId: string) {
    const system = normaliseSystem(rawSystem);
    const externalId = normaliseExternalId(rawExternalId);

    const link = await this.prisma.identityLink.findUnique({
      where: { system_externalId: { system, externalId } },
      include: { user: { select: UzaIdentityService.PERSON_SELECT } },
    });
    if (!link) return null;

    return {
      uzaId: link.uzaId,
      system: link.system,
      externalId: link.externalId,
      linkedAt: link.linkedAt,
      person: link.user,
    };
  }

  /** Every external key currently pointing at this person. */
  async linksFor(rawUzaId: string) {
    const person = await this.requirePerson(rawUzaId);
    const links = await this.prisma.identityLink.findMany({
      where: { uzaId: person.uzaId },
      orderBy: [{ system: 'asc' }, { linkedAt: 'asc' }],
    });
    return { person, links };
  }

  /**
   * Record that another system's key belongs to this person.
   *
   * Idempotent on `(system, externalId)`: linking the same key to the same person twice is
   * a no-op that returns the original row, so a charge point or a garage terminal may call
   * this on every visit. Re-pointing an existing key at a DIFFERENT person is refused —
   * see `assertLinkTarget` for why that has to be a deliberate correction.
   */
  async link(
    input: {
      uzaId: string;
      system: string;
      externalId: string;
      linkedByUserId?: string;
    },
    auditContext: RequestAuditContext = {},
  ) {
    const person = await this.requirePerson(input.uzaId);
    const system = normaliseSystem(input.system);
    const externalId = normaliseExternalId(input.externalId);

    const existing = await this.prisma.identityLink.findUnique({
      where: { system_externalId: { system, externalId } },
    });
    assertLinkTarget(existing, person.uzaId);
    if (existing) return { link: existing, created: false };

    const link = await this.prisma.identityLink.create({
      data: {
        uzaId: person.uzaId,
        system,
        externalId,
        linkedBy: input.linkedByUserId ?? null,
      },
    });

    await this.auditService.record({
      userId: input.linkedByUserId,
      action: 'identity:link-created',
      entity: 'IdentityLink',
      entityId: link.id,
      metadata: { uzaId: person.uzaId, system, externalId },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return { link, created: true };
  }
}
