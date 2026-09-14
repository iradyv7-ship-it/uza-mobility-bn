import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoanChangeType, LoanStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { findLender } from './lenders.registry';
import {
  quoteLoan,
  recalculateForNewTenor,
  UNGUKA_RATE_BANDS,
} from './loan-terms';
import { inspectionEconomicsFor } from '../workshop/inspection-economics';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

/** Staff roles that do real day-to-day Twara EV / UZA Empower work on a loan file. */
const LOAN_STAFF_ROLES = ['FINANCE_ADMIN', 'INTAKE_OFFICER', 'SUPER_ADMIN'];

interface CreateLoanInput {
  borrowerUserId: string;
  lenderKey: string;
  vehiclePriceRwf: number;
  clientContributionRwf: number;
  tenorMonths: number;
  status?: LoanStatus;
  vehicle: {
    chassisNumber: string;
    make?: string;
    model?: string;
    year?: number;
    color?: string;
    plate?: string;
  };
  createdByUserId: string;
}

interface ChangeTenorInput {
  loanId: string;
  newTenorMonths: number;
  reason?: string;
  changedByUserId: string;
}

interface RequestChangeInput {
  loanId: string;
  requestedByUserId: string;
  requestedByName: string;
  changeType: LoanChangeType;
  payload: Record<string, unknown>;
  note?: string;
}

interface ReviewChangeInput {
  changeRequestId: string;
  reviewedByUserId: string;
  approve: boolean;
  reviewNote?: string;
}

/**
 * Everything that did not exist anywhere in this codebase before the Twara EV batch-1
 * onboarding work: originating a loan, changing its tenor with a real recalculation, and
 * the lender-proposes / UZA-approves change-request gate. See docs/mobility-audit.md and
 * this file's own tests for the reasoning behind each design choice below.
 *
 * Rate bands: only Unguka's are on file (`UNGUKA_RATE_BANDS`, see loan-terms.ts) — every
 * method here refuses a loan or change for any other lender rather than guessing a rate
 * nobody agreed to, the same rule `resolveAnnualRateBps` already enforces one level down.
 */
@Injectable()
export class LoanLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  private bandsFor(lenderKey: string) {
    if (lenderKey !== 'unguka') {
      throw new BadRequestException(
        `no agreed interest-rate bands are on file for "${lenderKey}" yet — only Unguka's are`,
      );
    }
    return UNGUKA_RATE_BANDS;
  }

  /**
   * The next loan reference, LOAN-<year>-000123. Derived from the highest existing ref
   * rather than a row count, which collides the moment a row is ever deleted — the same
   * reasoning FundApplicationService.nextRef already documents.
   */
  private async nextLoanRef(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `LOAN-${year}-`;
    const newest = await this.prisma.loan.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const next = newest
      ? Number.parseInt(newest.reference.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(Number.isNaN(next) ? 1 : next).padStart(6, '0')}`;
  }

  async createLoan(input: CreateLoanInput) {
    const lender = findLender(input.lenderKey);
    if (!lender) {
      throw new BadRequestException(`unknown lender key: ${input.lenderKey}`);
    }

    const bank = await this.prisma.bank.findUnique({
      where: { lenderKey: lender.key },
    });
    if (!bank) {
      throw new BadRequestException(
        `no Bank row is configured for lender "${lender.key}" yet`,
      );
    }

    const borrower = await this.prisma.user.findUnique({
      where: { id: input.borrowerUserId },
      select: { uzaId: true },
    });
    if (!borrower) {
      throw new NotFoundException('Borrower not found');
    }
    if (!borrower.uzaId) {
      throw new BadRequestException(
        'The borrower needs a UZA id before a loan can be originated for them ' +
          '(POST /admin/users/:id/uza-id)',
      );
    }

    const financedRwf = input.vehiclePriceRwf - input.clientContributionRwf;
    if (financedRwf <= 0) {
      throw new BadRequestException(
        'the contribution must be less than the vehicle price',
      );
    }

    const bands = this.bandsFor(lender.key);
    const quote = quoteLoan(financedRwf, input.tenorMonths, bands);
    const reference = await this.nextLoanRef();

    // A loan is UZA choosing to originate financing WITH this specific bank on this
    // borrower's behalf — which is, in substance, exactly what "the borrower consents to
    // this bank seeing their data" means. Recorded as STAFF_RECORDED consent so
    // LenderAccessGuard's disclosure check (mayDisclose, see lender-access.ts) has
    // something real to find, the same as a signed FundApplication would leave behind.
    await this.prisma.lenderConsent.upsert({
      where: {
        uzaId_lenderKey: { uzaId: borrower.uzaId, lenderKey: lender.key },
      },
      update: { withdrawnAt: null },
      create: {
        uzaId: borrower.uzaId,
        lenderKey: lender.key,
        source: 'STAFF_RECORDED',
        capturedByRef: input.createdByUserId,
        note: 'Recorded at loan origination (Twara EV batch onboarding).',
      },
    });

    const loan = await this.prisma.loan.create({
      data: {
        reference,
        bankId: bank.id,
        borrowerUserId: input.borrowerUserId,
        vehiclePriceRwf: input.vehiclePriceRwf,
        clientContributionRwf: input.clientContributionRwf,
        principalRwf: quote.financedRwf,
        tenorMonths: quote.tenorMonths,
        annualRateBps: quote.annualRateBps,
        monthlyRwf: quote.monthlyRwf,
        dailyRwf: quote.dailyRwf,
        totalRepayableRwf: quote.totalRepayableRwf,
        outstandingRwf: quote.financedRwf,
        status: input.status ?? 'PENDING',
        vehicle: { create: { ...input.vehicle } },
      },
      include: { vehicle: true },
    });

    await this.auditService.record({
      userId: input.createdByUserId,
      action: 'loan:originate',
      entity: 'Loan',
      entityId: loan.id,
      metadata: {
        reference: loan.reference,
        lenderKey: lender.key,
        borrowerUserId: input.borrowerUserId,
      },
    });

    return loan;
  }

  private async requireLoan(loanId: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { bank: true, vehicle: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  /**
   * What actually happens when a loan's tenor changes: a fresh quote on the OUTSTANDING
   * balance at the new tenor's own rate band (see recalculateForNewTenor's doc comment),
   * written back to the loan, with a LoanTenorChange row preserving what the terms were
   * before. Every affected party is notified — this used to be entirely manual and silent.
   */
  async changeTenor(input: ChangeTenorInput) {
    const loan = await this.requireLoan(input.loanId);
    const bands = this.bandsFor(loan.bank.lenderKey ?? '');
    const requote = recalculateForNewTenor(
      loan.outstandingRwf,
      input.newTenorMonths,
      bands,
    );

    const [updatedLoan] = await this.prisma.$transaction([
      this.prisma.loan.update({
        where: { id: input.loanId },
        data: {
          tenorMonths: requote.tenorMonths,
          annualRateBps: requote.annualRateBps,
          monthlyRwf: requote.monthlyRwf,
          dailyRwf: requote.dailyRwf,
          totalRepayableRwf: requote.totalRepayableRwf,
        },
      }),
      this.prisma.loanTenorChange.create({
        data: {
          loanId: input.loanId,
          fromTenorMonths: loan.tenorMonths,
          toTenorMonths: requote.tenorMonths,
          fromMonthlyRwf: loan.monthlyRwf,
          toMonthlyRwf: requote.monthlyRwf,
          fromDailyRwf: loan.dailyRwf,
          toDailyRwf: requote.dailyRwf,
          reason: input.reason,
          changedByUserId: input.changedByUserId,
        },
      }),
    ]);

    await this.auditService.record({
      userId: input.changedByUserId,
      action: 'loan:change-tenor',
      entity: 'Loan',
      entityId: loan.id,
      metadata: {
        reference: loan.reference,
        fromTenorMonths: loan.tenorMonths,
        toTenorMonths: requote.tenorMonths,
      },
    });

    const direction =
      requote.tenorMonths > loan.tenorMonths ? 'stretched' : 'shortened';

    await Promise.all([
      this.notificationsService.send({
        userId: loan.borrowerUserId,
        type: 'FINANCING_UPDATE',
        title: 'Your loan payment period changed',
        body: `Your repayment period ${direction} from ${loan.tenorMonths} to ${requote.tenorMonths} months. New daily target: RWF ${requote.dailyRwf.toLocaleString()}.`,
        metadata: {
          loanId: loan.id,
          fromTenorMonths: loan.tenorMonths,
          toTenorMonths: requote.tenorMonths,
        },
      }),
      this.notificationsService.sendToRoleNames(LOAN_STAFF_ROLES, {
        type: 'FINANCING_UPDATE',
        title: `Loan ${loan.reference}: tenor ${direction}`,
        body: `${loan.tenorMonths} → ${requote.tenorMonths} months. New monthly payment: RWF ${requote.monthlyRwf.toLocaleString()}.`,
        metadata: { loanId: loan.id },
      }),
    ]);

    return { loan: updatedLoan, quote: requote };
  }

  /** The lender's side of the gate: propose a change, wait for UZA to review it. */
  async requestChange(input: RequestChangeInput) {
    await this.requireLoan(input.loanId);

    const request = await this.prisma.loanChangeRequest.create({
      data: {
        loanId: input.loanId,
        requestedByUserId: input.requestedByUserId,
        changeType: input.changeType,
        payload: input.payload as never,
        note: input.note,
      },
    });

    await this.notificationsService.sendToRoleNames(LOAN_STAFF_ROLES, {
      type: 'FINANCING_UPDATE',
      title: `${input.requestedByName} proposed a loan change`,
      body: `${input.changeType} change requested on loan ${input.loanId}. Awaiting review.`,
      metadata: { loanId: input.loanId, changeRequestId: request.id },
    });

    return request;
  }

  /** UZA's side of the gate: approve (and apply) or reject a lender's proposed change. */
  async reviewChange(input: ReviewChangeInput) {
    const request = await this.prisma.loanChangeRequest.findUnique({
      where: { id: input.changeRequestId },
      include: { loan: true, requestedBy: true },
    });
    if (!request) throw new NotFoundException('Change request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `this request was already ${request.status.toLowerCase()}`,
      );
    }

    if (!input.approve) {
      const rejected = await this.prisma.loanChangeRequest.update({
        where: { id: input.changeRequestId },
        data: {
          status: 'REJECTED',
          reviewedByUserId: input.reviewedByUserId,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote,
        },
      });

      await this.notificationsService.send({
        userId: request.requestedByUserId,
        type: 'FINANCING_UPDATE',
        title: 'Your proposed loan change was not approved',
        body:
          input.reviewNote ??
          `Loan ${request.loan.reference}'s ${request.changeType} change was declined.`,
        metadata: { loanId: request.loanId, changeRequestId: request.id },
      });

      return rejected;
    }

    // Approve AND apply, atomically with marking the request applied.
    const payload = request.payload as Record<string, unknown>;

    if (request.changeType === 'TENOR') {
      const toTenorMonths = Number(payload.toTenorMonths);
      if (!Number.isInteger(toTenorMonths) || toTenorMonths <= 0) {
        throw new BadRequestException(
          'payload.toTenorMonths must be a positive integer',
        );
      }
      await this.changeTenor({
        loanId: request.loanId,
        newTenorMonths: toTenorMonths,
        reason: `Approved change request from ${request.requestedBy.firstName} ${request.requestedBy.lastName}`,
        changedByUserId: input.reviewedByUserId,
      });
    } else if (request.changeType === 'CONTRIBUTION') {
      const contributionRwf = Number(payload.contributionRwf);
      if (!Number.isFinite(contributionRwf) || contributionRwf < 0) {
        throw new BadRequestException(
          'payload.contributionRwf must be a non-negative number',
        );
      }
      await this.prisma.loan.update({
        where: { id: request.loanId },
        data: { clientContributionRwf: contributionRwf },
      });
    } else if (request.changeType === 'VEHICLE_PRICE') {
      const vehiclePriceRwf = Number(payload.vehiclePriceRwf);
      if (!Number.isFinite(vehiclePriceRwf) || vehiclePriceRwf <= 0) {
        throw new BadRequestException(
          'payload.vehiclePriceRwf must be a positive number',
        );
      }
      await this.prisma.loan.update({
        where: { id: request.loanId },
        data: { vehiclePriceRwf },
      });
    }

    const applied = await this.prisma.loanChangeRequest.update({
      where: { id: input.changeRequestId },
      data: {
        status: 'APPLIED',
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote,
        appliedAt: new Date(),
      },
    });

    await this.notificationsService.send({
      userId: request.requestedByUserId,
      type: 'FINANCING_UPDATE',
      title: 'Your proposed loan change was approved and applied',
      body: `Loan ${request.loan.reference}'s ${request.changeType} change is now in effect.`,
      metadata: { loanId: request.loanId, changeRequestId: request.id },
    });

    return applied;
  }

  /**
   * Every loan, for staff — the list screen behind loan origination and tenor/change-
   * request review. Same pagination shape as FinancingService.findAllAdmin.
   */
  async listLoans(filters: {
    status?: LoanStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.LoanWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { reference: { contains: filters.search, mode: 'insensitive' } },
        {
          borrower: {
            OR: [
              { firstName: { contains: filters.search, mode: 'insensitive' } },
              { lastName: { contains: filters.search, mode: 'insensitive' } },
              { uzaId: { contains: filters.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: true,
          borrower: {
            select: { id: true, uzaId: true, firstName: true, lastName: true },
          },
          bank: { select: { name: true, lenderKey: true } },
        },
      }),
      this.prisma.loan.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /** A single loan's full current state, for staff review — including its tenor-change history. */
  async getLoan(loanId: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        vehicle: true,
        tenorChanges: { orderBy: { createdAt: 'asc' } },
        borrower: {
          select: { id: true, uzaId: true, firstName: true, lastName: true },
        },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');

    // The inspection reserve this vehicle's cadence implies — see inspection-economics.ts.
    // Shown here so a loan's own file already answers "what should this driver be setting
    // aside for inspections," not just "what do they owe on the loan itself." The rate is
    // whatever a SUPER_ADMIN currently has set in Platform Settings, not a hardcoded guess.
    const inspectionRateRwf =
      await this.platformSettingsService.getInspectionRateRwf();
    const inspectionEconomics = inspectionEconomicsFor(
      loan.vehicle?.condition ?? 'USED',
      inspectionRateRwf,
    );

    return { ...loan, inspectionEconomics };
  }

  async listChangeRequests(loanId: string) {
    await this.requireLoan(loanId);
    return this.prisma.loanChangeRequest.findMany({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
