import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkshopService } from '../workshop/workshop.service';
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
}
