import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkshopService } from '../workshop/workshop.service';
import type { AskInfoRequestDto } from './dto/ask-info-request.dto';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import type { RecordLenderDecisionDto } from './dto/record-lender-decision.dto';
import {
  assertDecisionAllowed,
  loanStatusForDecision,
} from './lender-decision.rules';
import type { LenderConfig } from './lenders.registry';
import { summarizeSavings } from './loan-savings.util';

/**
 * What a bank sees about its own loan book.
 *
 * Scoped to `Loan`, not `FinancingRequest` — a `FinancingRequest` is UZA facilitating a
 * buyer's paperwork before any lender has agreed to anything (see financing.service.ts);
 * a `Loan` exists once a bank has actually approved and (usually) disbursed. Keeping the
 * two apart means this file can never show a bank an application it never received.
 *
 * A lender whose `Bank` row has no `lenderKey` set yet, or one with a key but zero loans,
 * gets honest zeroes and empty lists here — not an error. Onboarding a bank in
 * `lenders.registry.ts` is meant to be routine; somebody still has to book its first loan.
 */
@Injectable()
export class LenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workshopService: WorkshopService,
    private readonly auditService: AuditService,
  ) {}

  private async resolveBankId(lender: LenderConfig): Promise<string | null> {
    const bank = await this.prisma.bank.findUnique({
      where: { lenderKey: lender.key },
      select: { id: true },
    });
    return bank?.id ?? null;
  }

  /**
   * A loan, only if it belongs to this lender's own bank — the same 404-for-both
   * shape as `LenderAccessGuard` itself: a loan that exists but belongs to another
   * bank must be indistinguishable from a loan that does not exist at all.
   */
  private async requireOwnLoan(lender: LenderConfig, loanId: string) {
    const bankId = await this.resolveBankId(lender);
    const loan = bankId
      ? await this.prisma.loan.findFirst({ where: { id: loanId, bankId } })
      : null;
    if (!loan) throw new NotFoundException();
    return loan;
  }

  /** The equity gap this loan closed: what the vehicle cost, what the buyer brought, and
   *  what UZA Empower topped up to reach it — the latter summed from this loan's own
   *  PLEDGED collateral entries, never stored as a separate, driftable field. */
  private async equityBreakdown(loanId: string) {
    const pledged = await this.prisma.collateralEntry.aggregate({
      where: { loanId, kind: 'PLEDGED' },
      _sum: { amountRwf: true },
    });
    return { uzaTopUpRwf: pledged._sum.amountRwf ?? 0 };
  }

  async summary(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) {
      return {
        applicationsPending: 0,
        activeLoans: 0,
        disbursedTotal: 0,
        arrearsTotal: 0,
      };
    }

    const [applicationsPending, activeLoans, disbursed, arrears] =
      await Promise.all([
        this.prisma.loan.count({
          where: { bankId, status: { in: ['PENDING', 'IN_REVIEW'] } },
        }),
        this.prisma.loan.count({
          where: { bankId, status: { in: ['ACTIVE', 'IN_ARREARS'] } },
        }),
        this.prisma.loan.aggregate({
          where: { bankId, disbursedAt: { not: null } },
          _sum: { principalRwf: true },
        }),
        this.prisma.loan.aggregate({
          where: { bankId },
          _sum: { arrearsRwf: true },
        }),
      ]);

    return {
      applicationsPending,
      activeLoans,
      disbursedTotal: disbursed._sum.principalRwf ?? 0,
      arrearsTotal: arrears._sum.arrearsRwf ?? 0,
    };
  }

  /** Loans not yet decided — the bank's open pipeline. */
  async applications(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const rows = await this.prisma.loan.findMany({
      where: { bankId, status: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
      include: { borrower: { select: { firstName: true, lastName: true } } },
    });

    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        reference: r.reference,
        applicantName: `${r.borrower.firstName} ${r.borrower.lastName}`.trim(),
        amount: r.principalRwf,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        vehiclePriceRwf: r.vehiclePriceRwf,
        clientContributionRwf: r.clientContributionRwf,
        ...(await this.equityBreakdown(r.id)),
      })),
    );
  }

  /** Every borrower this bank has an active or historical loan relationship with. */
  async borrowers(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const rows = await this.prisma.loan.findMany({
      where: {
        bankId,
        status: { notIn: ['PENDING', 'IN_REVIEW', 'DECLINED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        borrower: { select: { uzaId: true, firstName: true, lastName: true } },
      },
    });

    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        uzaId: r.borrower.uzaId ?? '',
        displayName: `${r.borrower.firstName} ${r.borrower.lastName}`.trim(),
        loanRef: r.reference,
        balance: r.outstandingRwf,
        status: r.status,
        vehiclePriceRwf: r.vehiclePriceRwf,
        clientContributionRwf: r.clientContributionRwf,
        ...(await this.equityBreakdown(r.id)),
      })),
    );
  }

  async disbursements(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const rows = await this.prisma.loan.findMany({
      where: { bankId, disbursedAt: { not: null } },
      orderBy: { disbursedAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      amount: r.principalRwf,
      disbursedAt: r.disbursedAt!.toISOString(),
      status: r.status,
    }));
  }

  /**
   * Grouped by disbursal month, which is the one cohort boundary the data actually
   * carries. `Loan` has no separate "cohort" field to fabricate a grouping from — this
   * one is real, if coarse, and can be refined once there is a reason to.
   */
  async portfolio(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const rows = await this.prisma.loan.findMany({
      where: { bankId, disbursedAt: { not: null } },
      select: { disbursedAt: true, outstandingRwf: true, arrearsRwf: true },
    });

    const byMonth = new Map<
      string,
      { count: number; outstanding: number; arrears: number }
    >();
    for (const r of rows) {
      const cohort = r.disbursedAt!.toISOString().slice(0, 7); // YYYY-MM
      const bucket = byMonth.get(cohort) ?? {
        count: 0,
        outstanding: 0,
        arrears: 0,
      };
      bucket.count += 1;
      bucket.outstanding += r.outstandingRwf;
      bucket.arrears += r.arrearsRwf;
      byMonth.set(cohort, bucket);
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([cohort, bucket]) => ({
        id: cohort,
        cohort,
        count: bucket.count,
        outstanding: bucket.outstanding,
        arrears: bucket.arrears,
      }));
  }

  /**
   * The cash-collateral facility. Only ever called from a route the guard has already
   * confirmed this lender is entitled to (`seesCollateral`) — see lender.controller.ts.
   */
  async creditEnhancement(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return { pledged: 0, released: 0, calledBack: 0 };

    const entries = await this.prisma.collateralEntry.findMany({
      where: { bankId },
      select: { kind: true, amountRwf: true },
    });

    const sum = (kind: 'PLEDGED' | 'RELEASED' | 'CALLED_BACK') =>
      entries
        .filter((e) => e.kind === kind)
        .reduce((total, e) => total + e.amountRwf, 0);

    return {
      pledged: sum('PLEDGED'),
      released: sum('RELEASED'),
      calledBack: sum('CALLED_BACK'),
    };
  }

  /**
   * One of the two data products UZA Empower gives a lender in exchange for financing at
   * better terms than the vehicle alone would justify — see `InspectionsController`. 404s
   * (via `requireOwnLoan`) rather than an empty list for a loan belonging to another
   * bank, same reasoning as everywhere else in this guard chain.
   */
  async inspectionsForLoan(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.workshopService.listInspectionsForLoan(loanId);
  }

  /**
   * The other data product: daily deposits against the loan's required daily figure,
   * with the running surplus/shortfall a lender actually cares about — a candidate
   * consistently ahead of `requiredDailyRwf` is the live signal that they may support
   * more, not just that they can service this loan (see LoanSavingsEntry's own comment).
   */
  async savingsForLoan(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);

    const rows = await this.prisma.loanSavingsEntry.findMany({
      where: { loanId },
      orderBy: { date: 'asc' },
    });

    return summarizeSavings(
      rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        depositedRwf: r.depositedRwf,
        requiredDailyRwf: r.requiredDailyRwf,
      })),
    );
  }

  /**
   * A richer view of `applications()` for the bank's working queue: the same pending /
   * in-review loans, plus whether each one has an information request still awaiting a
   * UZA answer and its latest recorded decision, if any. Parallels `applications()`
   * rather than replacing it — a consumer already calling that endpoint keeps working.
   */
  async queue(lender: LenderConfig) {
    const bankId = await this.resolveBankId(lender);
    if (!bankId) return [];

    const rows = await this.prisma.loan.findMany({
      where: { bankId, status: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        borrower: { select: { firstName: true, lastName: true } },
        infoRequests: {
          where: { answeredAt: null },
          select: { id: true, question: true, askedAt: true },
          orderBy: { askedAt: 'desc' },
          take: 1,
        },
        lenderDecisions: {
          select: { outcome: true, decidedAt: true },
          orderBy: { decidedAt: 'desc' },
          take: 1,
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      applicantName: `${r.borrower.firstName} ${r.borrower.lastName}`.trim(),
      amount: r.principalRwf,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      openInfoRequest: r.infoRequests[0] ?? null,
      latestDecision: r.lenderDecisions[0] ?? null,
    }));
  }

  /**
   * Record a credit decision — the structured replacement for silently flipping
   * `Loan.status`. Only moves the loan's own status for APPROVED/REJECTED, and only from
   * a state the bank is actually allowed to decide on; CONDITIONAL leaves status alone
   * (still IN_REVIEW — a conditional approval is not yet a disbursement decision).
   */
  async recordDecision(
    lender: LenderConfig,
    loanId: string,
    dto: RecordLenderDecisionDto,
    actorUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const loan = await this.requireOwnLoan(lender, loanId);
    assertDecisionAllowed(loan.status, dto);

    const nextStatus = loanStatusForDecision(dto.outcome);

    const decision = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lenderDecision.create({
        data: {
          loanId,
          outcome: dto.outcome,
          reasons: dto.reasons,
          conditions: dto.conditions ?? null,
          decidedByRef: actorUserId,
        },
      });

      if (nextStatus) {
        await tx.loan.update({
          where: { id: loanId },
          data: { status: nextStatus },
        });
      }

      return created;
    });

    await this.auditService.record({
      userId: actorUserId,
      action: `lender-decision:${dto.outcome.toLowerCase()}`,
      entity: 'LenderDecision',
      entityId: decision.id,
      metadata: {
        loanId,
        lenderKey: lender.key,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return decision;
  }

  async listDecisions(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.lenderDecision.findMany({
      where: { loanId },
      orderBy: { decidedAt: 'desc' },
    });
  }

  /** A bank asking UZA a question about one of its own loans. */
  async askInfoRequest(
    lender: LenderConfig,
    loanId: string,
    dto: AskInfoRequestDto,
    actorUserId: string,
  ) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.infoRequest.create({
      data: {
        loanId,
        question: dto.question,
        askedByRef: actorUserId,
      },
    });
  }

  /** The bank's own view of its question-and-answer thread on one loan. */
  async listInfoRequests(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.infoRequest.findMany({
      where: { loanId },
      orderBy: { askedAt: 'desc' },
    });
  }

  /**
   * A bank-internal underwriting note. Deliberately the only place in this codebase that
   * writes `prisma.creditNote` from the lender side — see the model's own doc comment on
   * why nothing staff-facing may ever touch this table.
   */
  async addCreditNote(
    lender: LenderConfig,
    loanId: string,
    dto: CreateCreditNoteDto,
    actorUserId: string,
  ) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.creditNote.create({
      data: {
        loanId,
        note: dto.note,
        authorRef: actorUserId,
      },
    });
  }

  /** The bank's own credit notes on one loan. Never exposed to a UZA-staff caller. */
  async listCreditNotes(lender: LenderConfig, loanId: string) {
    await this.requireOwnLoan(lender, loanId);
    return this.prisma.creditNote.findMany({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
