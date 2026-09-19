import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { AllocateDto } from './dto/allocate.dto';
import type { ConfirmDepositDto } from './dto/confirm-deposit.dto';
import type { OpenWalletDto } from './dto/open-wallet.dto';
import type { RecordDepositDto } from './dto/record-deposit.dto';
import type { SetSplitDto } from './dto/set-split.dto';
import {
  assertAllocationAllowed,
  assertSplitSumsTo100,
  BUCKET_LABELS,
  bucketBalances,
  momoIdempotencyKey,
  performance,
  splitDeposit,
  type Bucket,
  type LedgerLine,
} from './wallet.rules';

/**
 * The wallet, as the driver's companion and the lender's evidence.
 *
 * Every write goes through the ledger with an idempotency key and a running balance. Every
 * read the driver sees says whose money it is and where it sits. Every read a lender sees
 * goes through `LenderService.requireOwnLoan` and counts confirmed lines only.
 *
 * The `Wallet` row's `balanceRwf` / `reserveBalanceRwf` are maintained as the confirmed
 * total across all buckets and the confirmed total in LOAN respectively, so the older
 * daily-split code (SECTION 13) keeps working; the per-bucket view is computed from lines.
 */

/** Ledger money is BigInt in Postgres and a Number on the wire. Whole francs never exceed 2^53. */
function plain<T>(row: T): T {
  return JSON.parse(
    JSON.stringify(row, (_k, v: unknown) =>
      typeof v === 'bigint' ? Number(v) : v,
    ),
  ) as T;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── Lookup ─────────────────────────────────────────────────────────────────────────

  private async walletForUser(userId: string) {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!w) {
      throw new NotFoundException(
        'No wallet yet. It is opened at enrolment, against your own account at the institution.',
      );
    }
    if (w.status !== 'ACTIVE') {
      throw new ForbiddenException('This wallet is not active. Contact UZA.');
    }
    return w;
  }

  private async walletForUzaId(uzaId: string) {
    const user = await this.prisma.user.findUnique({
      where: { uzaId: uzaId.trim().toUpperCase() },
      select: { id: true, uzaId: true, firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundException('No participant with that UZA ID.');
    return {
      user,
      wallet: await this.prisma.wallet.findUnique({
        where: { userId: user.id },
      }),
    };
  }

  private async lines(walletId: string): Promise<LedgerLine[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { occurredAt: 'asc' },
    });
    return rows.map((r) => ({
      bucket: r.bucket ?? null,
      direction: r.direction,
      amountRwf: Number(r.amountRwf),
      occurredAt: r.occurredAt,
      confirmedAt: r.confirmedAt,
      recordedBy: r.recordedBy,
      reason: r.reason,
    }));
  }

  // ── The driver's view ──────────────────────────────────────────────────────────────

  async overview(userId: string, now = new Date()) {
    const w = await this.walletForUser(userId);
    const lines = await this.lines(w.id);
    const balances = bucketBalances(lines);
    const perf = performance(
      lines,
      w.dailyTargetRwf,
      w.contributionTargetRwf,
      now,
    );
    const mandate = await this.prisma.sweepMandate.findUnique({
      where: { userId },
      select: {
        status: true,
        bankName: true,
        accountNumberMasked: true,
        activatedAt: true,
      },
    });

    return {
      whoseMoney: {
        // Said on every screen. Compliance and trust are the same sentence here.
        statement: `This is your money, in your own account at ${w.institutionName ?? 'your bank'}${w.institutionAccountMasked ? ` (${w.institutionAccountMasked})` : ''}. UZA does not hold it. UZA shows it to you and, with your consent, to your lender.`,
        institutionName: w.institutionName,
        institutionAccountMasked: w.institutionAccountMasked,
        standingInstruction: mandate
          ? { status: mandate.status, activatedAt: mandate.activatedAt }
          : null,
      },
      targets: {
        dailyTargetRwf: w.dailyTargetRwf,
        contributionTargetRwf: w.contributionTargetRwf,
      },
      buckets: balances.map((b) => ({ ...b, label: BUCKET_LABELS[b.bucket] })),
      split: {
        LOAN: w.splitLoanPct,
        MAINTENANCE: w.splitMaintenancePct,
        CHARGING: w.splitChargingPct,
        INSURANCE: w.splitInsurancePct,
        PERSONAL: w.splitPersonalPct,
      },
      performance: perf,
      today: {
        depositedRwf: perf.daily.at(-1)?.depositedRwf ?? 0,
        targetRwf: w.dailyTargetRwf ?? 0,
        remainingRwf: Math.max(
          0,
          (w.dailyTargetRwf ?? 0) - (perf.daily.at(-1)?.depositedRwf ?? 0),
        ),
      },
    };
  }

  async statement(userId: string, limit = 60) {
    const w = await this.walletForUser(userId);
    return this.prisma.ledgerEntry
      .findMany({
        where: { walletId: w.id },
        orderBy: { occurredAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200),
        select: {
          id: true,
          bucket: true,
          direction: true,
          reason: true,
          amountRwf: true,
          externalRef: true,
          recordedBy: true,
          confirmedAt: true,
          occurredAt: true,
          note: true,
        },
      })
      .then((rows) =>
        rows.map((r) => ({ ...r, amountRwf: Number(r.amountRwf) })),
      );
  }

  /**
   * The driver records a deposit they made to their own account. A claim until confirmed.
   * Idempotent on the MoMo transaction ID: the same SMS typed twice lands once, and the
   * second attempt returns the first line rather than an error, because the driver did
   * nothing wrong.
   */
  async recordDeposit(
    userId: string,
    dto: RecordDepositDto,
    ctx: RequestAuditContext = {},
  ) {
    const w = await this.walletForUser(userId);
    const key = momoIdempotencyKey(dto.momoTransactionId);
    const existing = await this.prisma.ledgerEntry.findFirst({
      where: { idempotencyKey: { startsWith: key } },
      select: { walletId: true, occurredAt: true },
    });
    if (existing) {
      if (existing.walletId !== w.id) {
        throw new BadRequestException(
          'That MoMo transaction ID has already been recorded on another wallet.',
        );
      }
      return {
        duplicate: true as const,
        message: 'Already recorded. Nothing to do.',
      };
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const split = dto.bucket
      ? ({ [dto.bucket]: dto.amountRwf } as Partial<Record<Bucket, number>>)
      : splitDeposit(dto.amountRwf, {
          LOAN: w.splitLoanPct,
          MAINTENANCE: w.splitMaintenancePct,
          CHARGING: w.splitChargingPct,
          INSURANCE: w.splitInsurancePct,
          PERSONAL: w.splitPersonalPct,
        });

    const created = await this.prisma.$transaction(async (tx) => {
      const out = [];
      for (const [bucket, amount] of Object.entries(split) as [
        Bucket,
        number,
      ][]) {
        if (!amount) continue;
        out.push(
          await tx.ledgerEntry.create({
            data: {
              walletId: w.id,
              direction: 'CREDIT',
              reason: 'MOMO_DEPOSIT',
              amountRwf: BigInt(amount),
              // Pending lines do not move the running balances; confirmation does.
              balanceAfterRwf: w.balanceRwf,
              reserveBalanceAfterRwf: w.reserveBalanceRwf,
              idempotencyKey: `${key}:${bucket}`,
              externalRef: dto.momoTransactionId.trim(),
              bucket: bucket,
              recordedBy: 'DRIVER',
              occurredAt,
              note: dto.bucket
                ? undefined
                : 'Split by your default rule: loan first.',
            },
          }),
        );
      }
      return out;
    });

    await this.auditService.record({
      userId,
      action: 'wallet:deposit-recorded',
      entity: 'LedgerEntry',
      metadata: {
        momo: dto.momoTransactionId.trim(),
        amountRwf: dto.amountRwf,
        split,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      duplicate: false as const,
      lines: created.map((c) => ({
        id: c.id,
        bucket: c.bucket,
        amountRwf: Number(c.amountRwf),
      })),
      message:
        'Recorded. It will show as confirmed once it appears on your bank statement.',
    };
  }

  /** Move a label between buckets. No money moves. */
  async allocate(
    userId: string,
    dto: AllocateDto,
    actor: 'DRIVER' | 'STAFF',
    actorUserId: string,
    ctx: RequestAuditContext = {},
  ) {
    const w = await this.walletForUser(userId);
    const balances = bucketBalances(await this.lines(w.id));
    assertAllocationAllowed(dto.from, dto.to, dto.amountRwf, balances, actor);
    if (actor === 'STAFF' && dto.from === 'LOAN' && !dto.reason?.trim()) {
      throw new BadRequestException(
        'Moving money out of the loan bucket needs a reason on the record.',
      );
    }
    const now = new Date();
    const key = `alloc:${w.id}:${now.getTime()}`;
    await this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          walletId: w.id,
          direction: 'DEBIT',
          reason: 'ADJUSTMENT',
          amountRwf: BigInt(dto.amountRwf),
          balanceAfterRwf: w.balanceRwf,
          reserveBalanceAfterRwf: w.reserveBalanceRwf,
          idempotencyKey: `${key}:out`,
          bucket: dto.from,
          recordedBy: actor === 'STAFF' ? 'STAFF' : 'DRIVER',
          confirmedAt: now,
          occurredAt: now,
          note: `Moved to ${BUCKET_LABELS[dto.to].en}${dto.reason ? ` — ${dto.reason}` : ''}`,
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          walletId: w.id,
          direction: 'CREDIT',
          reason: 'ADJUSTMENT',
          amountRwf: BigInt(dto.amountRwf),
          balanceAfterRwf: w.balanceRwf,
          reserveBalanceAfterRwf: w.reserveBalanceRwf,
          idempotencyKey: `${key}:in`,
          bucket: dto.to,
          recordedBy: actor === 'STAFF' ? 'STAFF' : 'DRIVER',
          confirmedAt: now,
          occurredAt: now,
          note: `Moved from ${BUCKET_LABELS[dto.from].en}${dto.reason ? ` — ${dto.reason}` : ''}`,
        },
      }),
    ]);
    await this.auditService.record({
      userId: actorUserId,
      action: 'wallet:allocated',
      entity: 'Wallet',
      entityId: w.id,
      metadata: {
        onBehalfOf: userId,
        from: dto.from,
        to: dto.to,
        amountRwf: dto.amountRwf,
        reason: dto.reason ?? null,
        actor,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return this.overview(userId);
  }

  async setSplit(userId: string, dto: SetSplitDto) {
    assertSplitSumsTo100(dto);
    await this.walletForUser(userId);
    await this.prisma.wallet.update({
      where: { userId },
      data: {
        splitLoanPct: dto.LOAN,
        splitMaintenancePct: dto.MAINTENANCE,
        splitChargingPct: dto.CHARGING,
        splitInsurancePct: dto.INSURANCE,
        splitPersonalPct: dto.PERSONAL,
      },
    });
    return this.overview(userId);
  }

  // ── Staff ──────────────────────────────────────────────────────────────────────────

  async open(
    staffUserId: string,
    dto: OpenWalletDto,
    ctx: RequestAuditContext = {},
  ) {
    const { user, wallet } = await this.walletForUzaId(dto.uzaId);
    const masked = `••••${dto.accountLastFour.replace(/\D/g, '').slice(-4)}`;
    // The daily target is the lender's daily figure. If staff did not type one and the
    // borrower already has a live loan, take it from there rather than leaving the driver
    // with a wallet that says "no target yet" while an instalment is running.
    let dailyTargetRwf = dto.dailyTargetRwf ?? wallet?.dailyTargetRwf ?? null;
    if (dailyTargetRwf == null) {
      const live = await this.prisma.loan.findFirst({
        where: {
          borrowerUserId: user.id,
          status: { in: ['APPROVED', 'DISBURSED', 'ACTIVE', 'IN_ARREARS'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { dailyRwf: true },
      });
      dailyTargetRwf = live?.dailyRwf ?? null;
    }
    const data = {
      institutionName: dto.institutionName.trim(),
      institutionAccountMasked: masked,
      dailyTargetRwf,
      contributionTargetRwf: dto.contributionTargetRwf,
    };
    const w = wallet
      ? await this.prisma.wallet.update({ where: { id: wallet.id }, data })
      : await this.prisma.wallet.create({ data: { userId: user.id, ...data } });
    await this.auditService.record({
      userId: staffUserId,
      action: wallet ? 'wallet:updated' : 'wallet:opened',
      entity: 'Wallet',
      entityId: w.id,
      metadata: {
        uzaId: user.uzaId,
        institution: data.institutionName,
        account: masked,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return plain(w);
  }

  /**
   * Confirm a driver-recorded line against the institution's statement. This is the moment
   * a claim becomes evidence, so it is the moment the running balances move.
   */
  async confirmDeposit(
    staffUserId: string,
    entryId: string,
    dto: ConfirmDepositDto,
    ctx: RequestAuditContext = {},
  ) {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException('No such ledger line.');
    if (entry.confirmedAt) return plain(entry);
    const w = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: entry.walletId },
    });
    const sign = entry.direction === 'CREDIT' ? 1n : -1n;
    const newBalance = w.balanceRwf + sign * entry.amountRwf;
    const newReserve =
      entry.bucket === 'LOAN'
        ? w.reserveBalanceRwf + sign * entry.amountRwf
        : w.reserveBalanceRwf;
    const [updated] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.update({
        where: { id: entryId },
        data: {
          confirmedAt: new Date(),
          confirmedRef: dto.statementRef.trim(),
          recordedBy: 'INSTITUTION',
          balanceAfterRwf: newBalance,
          reserveBalanceAfterRwf: newReserve,
          note: dto.note
            ? `${entry.note ?? ''} ${dto.note}`.trim()
            : entry.note,
        },
      }),
      this.prisma.wallet.update({
        where: { id: w.id },
        data: { balanceRwf: newBalance, reserveBalanceRwf: newReserve },
      }),
    ]);
    await this.auditService.record({
      userId: staffUserId,
      action: 'wallet:deposit-confirmed',
      entity: 'LedgerEntry',
      entityId: entryId,
      metadata: {
        statementRef: dto.statementRef,
        amountRwf: Number(entry.amountRwf),
        bucket: entry.bucket,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return plain(updated);
  }

  async pendingForStaff(uzaId?: string) {
    const where: Prisma.LedgerEntryWhereInput = {
      confirmedAt: null,
      direction: 'CREDIT',
    };
    if (uzaId) {
      const { wallet } = await this.walletForUzaId(uzaId);
      if (!wallet) return [];
      where.walletId = wallet.id;
    }
    return this.prisma.ledgerEntry
      .findMany({
        where,
        orderBy: { occurredAt: 'asc' },
        take: 200,
        include: {
          wallet: {
            select: {
              user: {
                select: { uzaId: true, firstName: true, lastName: true },
              },
            },
          },
        },
      })
      .then((rows) =>
        plain(
          rows.map((r) => ({
            ...r,
            amountRwf: Number(r.amountRwf),
            balanceAfterRwf: undefined,
            reserveBalanceAfterRwf: undefined,
          })),
        ),
      );
  }

  async fileForStaff(uzaId: string) {
    const { user, wallet } = await this.walletForUzaId(uzaId);
    if (!wallet) return { uzaId: user.uzaId, wallet: null };
    return {
      uzaId: user.uzaId,
      displayName: `${user.firstName} ${user.lastName}`.trim(),
      ...(await this.overview(user.id)),
    };
  }

  /** For the lender's loan view: confirmed only, loan-facing buckets only. No PERSONAL. */
  async performanceForUser(userId: string, now = new Date()) {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!w) return null;
    const lines = await this.lines(w.id);
    const perf = performance(
      lines,
      w.dailyTargetRwf,
      w.contributionTargetRwf,
      now,
    );
    const balances = bucketBalances(lines).filter(
      (b) => b.bucket !== 'PERSONAL',
    );
    return {
      dailyTargetRwf: w.dailyTargetRwf,
      contributionTargetRwf: w.contributionTargetRwf,
      confirmedByBucket: balances.map((b) => ({
        bucket: b.bucket,
        confirmedRwf: b.confirmedRwf,
      })),
      consistencyRatio: perf.consistencyRatio,
      currentStreak: perf.currentStreak,
      longestStreak: perf.longestStreak,
      daysHit: perf.daysHit,
      windowDays: perf.windowDays,
      progressPct: perf.progressPct,
      last30: perf.daily.slice(-30),
    };
  }
}
