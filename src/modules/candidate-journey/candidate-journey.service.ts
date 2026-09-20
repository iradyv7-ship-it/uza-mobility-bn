import { Injectable, NotFoundException } from '@nestjs/common';
import type { FundApplication, JourneyStage, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AcademyService } from '../academy/academy.service';
import { UzaIdentityService } from '../uza-identity/uza-identity.service';
import {
  CLOSED_JOURNEY_STAGES,
  assessEnrolmentReadiness,
  assessGaps,
  pickRelevantApplication,
  planEnrolmentTransition,
  type ApplicationOnFile,
  type EnrolmentReadiness,
} from './candidate-journey.rules';
import type { ListCandidatesDto } from './dto/list-candidates.dto';
import type { RegisterCandidateDto } from './dto/register-candidate.dto';

/**
 * Scorah's desk: the candidate list, the paperwork check, and the one move that puts a
 * candidate in front of Bosco.
 *
 * ── What was here before ─────────────────────────────────────────────────────────────────
 *
 * Migration 13 (`20260823062840_candidate_journey`) landed `candidate_journeys`,
 * `journey_events`, `eligibility_gaps` and `screenings` in August. Until now the only code
 * that touched any of them was one `groupBy` in `AcademyService.impact()` — nothing created
 * a journey, nothing moved a stage, and `JourneyEvent` had no writer at all.
 * `AllocationService`'s header says so in as many words and calls it a stated gap. This is
 * the writer.
 *
 * ── The workflow, as described ───────────────────────────────────────────────────────────
 *
 *   1. Scorah puts the candidate list together and corrects it      → `register`
 *   2. Each candidate needs a signed UZA Empower application        → `findOne` / `list`
 *   3. Once it is signed, they are approved to be trained           → `confirmAndEnrol`
 *   4. They appear in the trainer's workplace                       → `trainingReady`
 *
 * ── Append-only ──────────────────────────────────────────────────────────────────────────
 *
 * Every stage change writes a `JourneyEvent` in the same transaction as the stage itself.
 * Migration 13's own words: `stagedAt` cannot answer "how long did it sit at screening and
 * who moved it", and a mutable column never will. The event is the record; the column is
 * the convenience.
 */
@Injectable()
export class CandidateJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly identity: UzaIdentityService,
    private readonly academy: AcademyService,
  ) {}

  /**
   * The next journey reference.
   *
   * Highest existing ref + 1, not `count() + 1` — the count scheme collides the moment a
   * row is deleted. Same shape as `AllocationService.nextRef()` and
   * `FundApplicationService.nextRef()`.
   */
  private async nextRef(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `UZM-CJ-${new Date().getFullYear()}-`;
    const newest = await tx.candidateJourney.findFirst({
      where: { ref: { startsWith: prefix } },
      orderBy: { ref: 'desc' },
      select: { ref: true },
    });
    const next = newest
      ? Number.parseInt(newest.ref.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(6, '0')}`;
  }

  /** Only the columns the readiness rule reads, in the shape it expects. */
  private static toApplicationOnFile(
    app: Pick<
      FundApplication,
      | 'ref'
      | 'status'
      | 'signedAt'
      | 'signatureRef'
      | 'submittedAt'
      | 'createdAt'
    >,
  ): ApplicationOnFile {
    return {
      ref: app.ref,
      status: app.status,
      signedAt: app.signedAt,
      signatureRef: app.signatureRef,
      submittedAt: app.submittedAt,
      createdAt: app.createdAt,
    };
  }

  private static readonly APPLICATION_SELECT = {
    ref: true,
    status: true,
    signedAt: true,
    signatureRef: true,
    submittedAt: true,
    createdAt: true,
  } as const;

  /** Every application on file for these people, newest first, grouped by UZA ID. */
  private async applicationsFor(
    uzaIds: readonly string[],
  ): Promise<Map<string, ApplicationOnFile[]>> {
    if (!uzaIds.length) return new Map();
    const rows = await this.prisma.fundApplication.findMany({
      where: { uzaId: { in: [...uzaIds] } },
      select: { ...CandidateJourneyService.APPLICATION_SELECT, uzaId: true },
      orderBy: { createdAt: 'desc' },
    });
    const byUzaId = new Map<string, ApplicationOnFile[]>();
    for (const row of rows) {
      if (!row.uzaId) continue;
      const list = byUzaId.get(row.uzaId) ?? [];
      list.push(CandidateJourneyService.toApplicationOnFile(row));
      byUzaId.set(row.uzaId, list);
    }
    return byUzaId;
  }

  private async requireJourney(ref: string) {
    const journey = await this.prisma.candidateJourney.findUnique({
      where: { ref: ref.trim().toUpperCase() },
      include: {
        cohort: { select: { id: true, code: true, name: true, track: true } },
      },
    });
    if (!journey)
      throw new NotFoundException('No candidate journey with that reference.');
    return journey;
  }

  private async readinessFor(uzaId: string): Promise<{
    readiness: EnrolmentReadiness;
    application: ApplicationOnFile | null;
  }> {
    const applications = (await this.applicationsFor([uzaId])).get(uzaId) ?? [];
    const application = pickRelevantApplication(applications);
    return { readiness: assessEnrolmentReadiness(application), application };
  }

  /**
   * Put a candidate on the list, or correct an entry already on it.
   *
   * One journey per person at a time. A candidate registered before a cohort existed gets
   * the cohort written onto the SAME row when it is assigned — creating a second journey
   * there would split one person's history across two records and quietly break the
   * `@@unique([uzaId, cohortId])` intent. A journey that has already ended
   * (`ADVISED_TO_BUILD_FURTHER`, `EXITED_PROGRAMME`) is left alone and a new one is opened
   * beside it, which is what `IntakeSource.RETURNING` is for.
   *
   * The stage is NOT settable here. Moving a candidate is a transition with an event
   * attached, and it is the one thing this module refuses to let anybody do by hand.
   */
  async register(
    actorUserId: string,
    dto: RegisterCandidateDto,
    auditContext: RequestAuditContext = {},
  ) {
    const person = await this.identity.requirePerson(dto.uzaId);

    let cohortId: string | null = null;
    if (dto.cohortCode?.trim()) {
      const cohort = await this.prisma.cohort.findUnique({
        where: { code: dto.cohortCode.trim() },
        select: { id: true },
      });
      if (!cohort) throw new NotFoundException('No cohort with that code.');
      cohortId = cohort.id;
    }

    const existing = await this.prisma.candidateJourney.findFirst({
      where: {
        uzaId: person.uzaId,
        stage: { notIn: [...CLOSED_JOURNEY_STAGES] },
      },
      orderBy: { startedAt: 'desc' },
    });

    const data = {
      intakeSource: dto.intakeSource,
      referredBy: dto.referredBy?.trim() || null,
      referredOn: dto.referredOn ? new Date(dto.referredOn) : null,
      ...(cohortId ? { cohortId } : {}),
    };

    const journey = existing
      ? await this.prisma.candidateJourney.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.$transaction(async (tx) => {
          const created = await tx.candidateJourney.create({
            data: {
              ref: await this.nextRef(tx),
              uzaId: person.uzaId,
              stage: 'REGISTERED',
              ...data,
            },
          });
          // The first event is the registration itself. `fromStage` is null because there
          // was no prior stage — the column is nullable for exactly this row.
          await tx.journeyEvent.create({
            data: {
              journeyId: created.id,
              fromStage: null,
              toStage: 'REGISTERED',
              actorId: actorUserId,
              note: `Registered from ${dto.intakeSource}.`,
            },
          });
          return created;
        });

    await this.auditService.record({
      userId: actorUserId,
      action: existing
        ? 'candidate-journey:corrected'
        : 'candidate-journey:registered',
      entity: 'CandidateJourney',
      entityId: journey.id,
      metadata: {
        ref: journey.ref,
        uzaId: person.uzaId,
        intakeSource: dto.intakeSource,
        cohortCode: dto.cohortCode?.trim() ?? null,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return { journey, created: !existing };
  }

  /**
   * The candidate list, with the paperwork state on every row.
   *
   * This is the screen Scorah works from, so each row carries the answer to "can this
   * person go to training yet" and, when the answer is no, the sentence saying why. One
   * query for the journeys, one for the people, one for the applications and one for the
   * gaps — not four per row.
   */
  async list(dto: ListCandidatesDto) {
    const journeys = await this.prisma.candidateJourney.findMany({
      where: {
        ...(dto.stage ? { stage: dto.stage } : {}),
        ...(dto.intakeSource ? { intakeSource: dto.intakeSource } : {}),
        ...(dto.cohortCode?.trim()
          ? { cohort: { code: dto.cohortCode.trim() } }
          : {}),
      },
      include: {
        cohort: { select: { code: true, name: true, track: true } },
      },
      orderBy: [{ startedAt: 'asc' }, { ref: 'asc' }],
    });

    const uzaIds = journeys.map((j) => j.uzaId);
    const [people, applications, gaps] = await Promise.all([
      this.prisma.user.findMany({
        where: { uzaId: { in: uzaIds } },
        select: { uzaId: true, firstName: true, lastName: true, phone: true },
      }),
      this.applicationsFor(uzaIds),
      this.prisma.eligibilityGap.findMany({
        where: { journeyId: { in: journeys.map((j) => j.id) } },
        select: {
          journeyId: true,
          kind: true,
          status: true,
          detail: true,
          shortfallRwf: true,
          raisedByRole: true,
        },
      }),
    ]);

    const byUzaId = new Map(people.map((p) => [p.uzaId, p]));
    const gapsByJourney = new Map<string, typeof gaps>();
    for (const g of gaps) {
      gapsByJourney.set(g.journeyId, [
        ...(gapsByJourney.get(g.journeyId) ?? []),
        g,
      ]);
    }

    return journeys.map((journey) => {
      const application = pickRelevantApplication(
        applications.get(journey.uzaId) ?? [],
      );
      const readiness = assessEnrolmentReadiness(application);
      const person = byUzaId.get(journey.uzaId);
      const gapAssessment = assessGaps(gapsByJourney.get(journey.id) ?? []);

      return {
        ref: journey.ref,
        uzaId: journey.uzaId,
        displayName: person
          ? `${person.firstName} ${person.lastName}`.trim()
          : null,
        phone: person?.phone ?? null,
        stage: journey.stage,
        stagedAt: journey.stagedAt,
        intakeSource: journey.intakeSource,
        referredBy: journey.referredBy,
        cohort: journey.cohort,
        readiness,
        openGaps: gapAssessment.openCount,
        openShortfallRwf: gapAssessment.openShortfallRwf,
      };
    });
  }

  /** One candidate: the journey, its whole event history, the paperwork and the gaps. */
  async findOne(ref: string) {
    const journey = await this.requireJourney(ref);
    const [person, events, gaps, screenings, readiness] = await Promise.all([
      this.identity.findPerson(journey.uzaId),
      this.prisma.journeyEvent.findMany({
        where: { journeyId: journey.id },
        orderBy: { at: 'asc' },
      }),
      this.prisma.eligibilityGap.findMany({
        where: { journeyId: journey.id },
        orderBy: [{ status: 'asc' }, { raisedAt: 'asc' }],
      }),
      this.prisma.screening.findMany({
        where: { journeyId: journey.id },
        orderBy: { screenedAt: 'desc' },
      }),
      this.readinessFor(journey.uzaId),
    ]);

    const gapAssessment = assessGaps(gaps);
    return {
      journey,
      person,
      readiness: readiness.readiness,
      application: readiness.application,
      events,
      screenings,
      gaps: {
        ...gapAssessment,
        // BigInt is not JSON-serialisable and whole francs never exceed 2^53 — the same
        // conversion AllocationService and WalletService do on the way out.
        open: gapAssessment.open.map((g) => ({
          ...g,
          shortfallRwf: g.shortfallRwf === null ? null : Number(g.shortfallRwf),
        })),
        closed: gapAssessment.closed.map((g) => ({
          ...g,
          shortfallRwf: g.shortfallRwf === null ? null : Number(g.shortfallRwf),
        })),
      },
    };
  }

  /**
   * The screening surface: what a lender's own criteria say is still missing.
   *
   * Read-only, deliberately. Nothing here raises, closes or invents a gap — the kinds come
   * from `GapKind` and the rows come from whoever actually screened the candidate. Migration
   * 13 is explicit that opening a gap nobody has checked "would produce a confident report
   * about a fact never established", so this endpoint reports and does not create.
   */
  async screening(ref: string) {
    const journey = await this.requireJourney(ref);
    const [gaps, latest] = await Promise.all([
      this.prisma.eligibilityGap.findMany({
        where: { journeyId: journey.id },
        orderBy: [{ status: 'asc' }, { raisedAt: 'asc' }],
      }),
      this.prisma.screening.findFirst({
        where: { journeyId: journey.id },
        orderBy: { screenedAt: 'desc' },
      }),
    ]);

    const assessment = assessGaps(gaps);
    return {
      ref: journey.ref,
      uzaId: journey.uzaId,
      stage: journey.stage,
      latestScreening: latest,
      openCount: assessment.openCount,
      closedCount: assessment.closedCount,
      openShortfallRwf: assessment.openShortfallRwf,
      raisedByLenderCount: assessment.raisedByLenderCount,
      open: assessment.open.map((g) => ({
        kind: g.kind,
        status: g.status,
        detail: g.detail,
        shortfallRwf: g.shortfallRwf === null ? null : Number(g.shortfallRwf),
        raisedByRole: g.raisedByRole,
      })),
      note: 'Open gaps do not block training. Training, savings and placement are how they close.',
    };
  }

  /**
   * Confirm the paperwork and send the candidate to training.
   *
   * This is step 2 of the founder's workflow and the only stage transition this module
   * performs. Idempotent in both halves: confirming a candidate who is already enrolled
   * changes nothing and writes no second event, and the academy enrolment is an upsert.
   *
   * ── Order of writes, and why ─────────────────────────────────────────────────────────
   *
   * The academy enrolment goes FIRST, then the stage and its event in one transaction.
   * `AcademyService.enrol` holds its own Prisma client and cannot join this transaction, so
   * one of the two has to happen outside it. Doing the enrolment first means the only way
   * this can half-complete is "enrolled in the cohort, stage not yet moved" — visible, and
   * fixed by calling this again. The other order gives "stage says ENROLLED, nobody told
   * the trainer", which looks finished and is not.
   *
   * ── When there is no cohort ──────────────────────────────────────────────────────────
   *
   * `Enrolment` requires one, so a candidate with no cohort assigned advances to ENROLLED
   * and gets `enrolment: null` with a note. That is honest rather than convenient: the
   * stage records that the paperwork is done, and the response says plainly that no
   * training place exists yet.
   */
  async confirmAndEnrol(
    actorUserId: string,
    ref: string,
    auditContext: RequestAuditContext = {},
  ) {
    const journey = await this.requireJourney(ref);
    const { readiness, application } = await this.readinessFor(journey.uzaId);

    const transition = planEnrolmentTransition(journey.stage, readiness);
    if (!transition) {
      return {
        journey,
        readiness,
        application,
        changed: false,
        enrolment: null,
        note: `Already at ${journey.stage}. Nothing to do.`,
      };
    }

    const enrolment = journey.cohort
      ? await this.academy.enrol(
          actorUserId,
          { uzaId: journey.uzaId, cohortCode: journey.cohort.code },
          auditContext,
        )
      : null;

    const { updated, event } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.candidateJourney.update({
        where: { id: journey.id },
        data: { stage: transition.to, stagedAt: new Date() },
      });
      const journeyEvent = await tx.journeyEvent.create({
        data: {
          journeyId: journey.id,
          fromStage: transition.from,
          toStage: transition.to,
          actorId: actorUserId,
          note: transition.note,
        },
      });
      return { updated: row, event: journeyEvent };
    });

    await this.auditService.record({
      userId: actorUserId,
      action: 'candidate-journey:enrolled',
      entity: 'CandidateJourney',
      entityId: journey.id,
      metadata: {
        ref: journey.ref,
        uzaId: journey.uzaId,
        fromStage: transition.from,
        toStage: transition.to,
        applicationRef: readiness.applicationRef,
        cohortCode: journey.cohort?.code ?? null,
        enrolmentId: enrolment?.id ?? null,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return {
      journey: updated,
      readiness,
      application,
      changed: true,
      event,
      enrolment,
      note: enrolment
        ? null
        : 'Stage advanced, but no cohort is assigned so no training place exists yet. Assign a cohort and confirm again.',
    };
  }

  /**
   * The trainer's list: who has been approved for training and whether a place exists.
   *
   * This is what makes a candidate "visible in Bosco's workplace". `enrolled` is the
   * `Enrolment` row the academy actually holds — a candidate at stage ENROLLED with
   * `enrolled: false` is one whose paperwork is done but who has no cohort place, which is
   * precisely the row a trainer needs to chase.
   */
  async trainingReady(cohortCode?: string) {
    const stages: JourneyStage[] = ['ENROLLED', 'TRAINING_IN_PROGRESS'];
    const journeys = await this.prisma.candidateJourney.findMany({
      where: {
        stage: { in: stages },
        ...(cohortCode?.trim() ? { cohort: { code: cohortCode.trim() } } : {}),
      },
      include: { cohort: { select: { code: true, name: true, track: true } } },
      orderBy: [{ stagedAt: 'asc' }, { ref: 'asc' }],
    });

    const uzaIds = journeys.map((j) => j.uzaId);
    const people = await this.prisma.user.findMany({
      where: { uzaId: { in: uzaIds } },
      select: {
        id: true,
        uzaId: true,
        firstName: true,
        lastName: true,
        phone: true,
        enrolments: {
          select: {
            id: true,
            status: true,
            enrolledAt: true,
            cohort: { select: { code: true } },
          },
        },
      },
    });
    const byUzaId = new Map(people.map((p) => [p.uzaId, p]));

    return journeys.map((journey) => {
      const person = byUzaId.get(journey.uzaId);
      const enrolment = person?.enrolments.find(
        (e) => e.cohort.code === journey.cohort?.code,
      );
      return {
        ref: journey.ref,
        uzaId: journey.uzaId,
        displayName: person
          ? `${person.firstName} ${person.lastName}`.trim()
          : null,
        phone: person?.phone ?? null,
        stage: journey.stage,
        approvedForTrainingAt: journey.stagedAt,
        cohort: journey.cohort,
        enrolled: !!enrolment,
        enrolment: enrolment ?? null,
      };
    });
  }

  /** The stage counts, for the programme view. One grouped query, never a row per stage. */
  async stageCounts(): Promise<Record<string, number>> {
    const rows = await this.prisma.candidateJourney.groupBy({
      by: ['stage'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.stage, r._count._all]));
  }
}
