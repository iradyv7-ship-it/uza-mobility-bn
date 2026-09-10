import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinancingStatus, NotificationType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestAuditContext } from '../../common/audit/request-context.util';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignBankDto } from './dto/assign-bank.dto';
import { CreateBankDto } from './dto/create-bank.dto';
import { CreateCollateralEntryDto } from './dto/create-collateral-entry.dto';
import { CreateFinancingRequestDto } from './dto/create-financing-request.dto';
import { CreateLoanSavingsEntryDto } from './dto/create-loan-savings-entry.dto';
import { FilterFinancingDto } from './dto/filter-financing.dto';
import { RecordFinancingOutcomeDto } from './dto/record-financing-outcome.dto';

const financingInclude = {
  assignedBank: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      totalAmountUsd: true,
      status: true,
    },
  },
  user: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
} satisfies Prisma.FinancingRequestInclude;

@Injectable()
export class FinancingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  async submitRequest(
    userId: string,
    dto: CreateFinancingRequestDto,
    auditContext: RequestAuditContext = {},
  ) {
    if (!dto.invoiceId && !dto.listingId) {
      throw new BadRequestException(
        'Provide invoiceId or listingId for financing support',
      );
    }

    if (dto.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: dto.invoiceId },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.userId !== userId) {
        throw new ForbiddenException('Invoice does not belong to this user');
      }
    }

    if (dto.listingId) {
      const listing = await this.prisma.listing.findFirst({
        where: { id: dto.listingId, deletedAt: null },
      });
      if (!listing) {
        throw new NotFoundException('Listing not found');
      }
    }

    const request = await this.prisma.financingRequest.create({
      data: {
        userId,
        buyerName: dto.buyerName,
        phone: dto.phone,
        buyerType: dto.buyerType,
        invoiceId: dto.invoiceId,
        listingId: dto.listingId,
        preferredDepositUsd: dto.preferredDepositUsd,
        preferredBankName: dto.preferredBankName,
        employmentStatus: dto.employmentStatus,
        organizationName: dto.organizationName,
        notes: dto.notes,
        status: FinancingStatus.SUBMITTED,
      },
      include: financingInclude,
    });

    await this.notificationsService.sendToRoleNames(
      ['FINANCE_ADMIN', 'SUPER_ADMIN'],
      {
        type: NotificationType.SYSTEM_ALERT,
        title: 'New financing support request',
        body: `${dto.buyerName} requested financing facilitation support.`,
        metadata: { requestId: request.id },
      },
    );

    await this.auditService.record({
      userId,
      action: 'financing:submitted',
      entity: 'FinancingRequest',
      metadata: { requestId: request.id, email: auditContext.actorEmail },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return this.toBuyerResponse(request);
  }

  async findMine(userId: string) {
    const rows = await this.prisma.financingRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: financingInclude,
    });

    return rows.map((row) => this.toBuyerResponse(row));
  }

  async findAllAdmin(filters: FilterFinancingDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;
    const skip = (page - 1) * limit;
    const where: Prisma.FinancingRequestWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where.OR = [
        { buyerName: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { organizationName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.financingRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: financingInclude,
      }),
      this.prisma.financingRequest.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findByIdAdmin(id: string) {
    const request = await this.prisma.financingRequest.findUnique({
      where: { id },
      include: financingInclude,
    });

    if (!request) {
      throw new NotFoundException('Financing request not found');
    }

    return request;
  }

  async assignBank(
    requestId: string,
    dto: AssignBankDto,
    adminUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const request = await this.getRequestOrThrow(requestId);

    if (
      request.status !== FinancingStatus.SUBMITTED &&
      request.status !== FinancingStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot assign bank when status is ${request.status}`,
      );
    }

    const bank = await this.prisma.bank.findFirst({
      where: { id: dto.bankId, isActive: true },
    });
    if (!bank) {
      throw new NotFoundException('Bank partner not found');
    }

    const updated = await this.prisma.financingRequest.update({
      where: { id: requestId },
      data: {
        assignedBankId: dto.bankId,
        status: FinancingStatus.SENT_TO_BANK,
        reviewNotes: dto.reviewNotes ?? request.reviewNotes,
      },
      include: financingInclude,
    });

    await this.notifyBuyer(updated.userId, {
      title: 'Financing request forwarded',
      body: 'Your financing support request has been forwarded to a partner institution for review.',
      requestId,
      status: FinancingStatus.SENT_TO_BANK,
    });

    await this.auditService.record({
      userId: adminUserId,
      action: 'financing:sent-to-bank',
      entity: 'FinancingRequest',
      metadata: {
        requestId,
        bankId: dto.bankId,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return updated;
  }

  async recordOutcome(
    requestId: string,
    dto: RecordFinancingOutcomeDto,
    adminUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const request = await this.getRequestOrThrow(requestId);

    if (request.status !== FinancingStatus.SENT_TO_BANK) {
      throw new BadRequestException(
        'Outcome can only be recorded after request was sent to bank',
      );
    }

    const updated = await this.prisma.financingRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status,
        reviewNotes: dto.reviewNotes ?? request.reviewNotes,
      },
      include: financingInclude,
    });

    const approved = dto.status === FinancingStatus.BANK_APPROVED;
    await this.notifyBuyer(updated.userId, {
      title: approved
        ? 'Financing support — bank approved'
        : 'Financing support — bank declined',
      body: approved
        ? 'A partner institution has indicated approval in principle. Uza Mobility does not provide financing directly; final terms are set by the bank.'
        : 'A partner institution did not approve this request. You may submit a new request for another institution if you wish.',
      requestId,
      status: dto.status,
    });

    await this.auditService.record({
      userId: adminUserId,
      action: approved ? 'financing:bank-approved' : 'financing:bank-rejected',
      entity: 'FinancingRequest',
      metadata: {
        requestId,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return updated;
  }

  async listBanks() {
    return this.prisma.bank.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createBank(
    dto: CreateBankDto,
    adminUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const bank = await this.prisma.bank.create({ data: dto });

    await this.auditService.record({
      action: 'banks:created',
      entity: 'Bank',
      metadata: { bankId: bank.id, name: bank.name },
      userId: adminUserId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return bank;
  }

  /**
   * Record a movement in a bank's collateral ledger — a bank-wide facility deposit when
   * `dto.loanId` is unset, or UZA Empower's equity top-up for one specific candidate's
   * vehicle purchase when it is set. Never a mutable balance: see CollateralEntry's own
   * doc comment. `Loan.clientContributionRwf`/`vehiclePriceRwf` are what the bank asked
   * for and what the buyer brought; the sum of this loan's PLEDGED rows is what UZA
   * closed the gap with — computed from this ledger, not stored again as its own field.
   */
  async createCollateralEntry(
    bankId: string,
    dto: CreateCollateralEntryDto,
    adminUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const bank = await this.prisma.bank.findUnique({ where: { id: bankId } });
    if (!bank) throw new NotFoundException('Bank not found');

    if (dto.loanId) {
      const loan = await this.prisma.loan.findUnique({
        where: { id: dto.loanId },
      });
      if (!loan) throw new NotFoundException('Loan not found');
      if (loan.bankId !== bankId) {
        throw new BadRequestException('Loan does not belong to this bank');
      }
    }

    const entry = await this.prisma.collateralEntry.create({
      data: {
        bankId,
        kind: dto.kind,
        amountRwf: dto.amountRwf,
        loanId: dto.loanId,
        note: dto.note,
      },
    });

    await this.auditService.record({
      userId: adminUserId,
      action: 'collateral:recorded',
      entity: 'CollateralEntry',
      entityId: entry.id,
      metadata: {
        bankId,
        loanId: dto.loanId,
        kind: dto.kind,
        amountRwf: dto.amountRwf,
        email: auditContext.actorEmail,
      },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return entry;
  }

  /**
   * Record one day's deposit against a loan's required daily figure — the ongoing-
   * behaviour signal UZA Empower gives a lender alongside VehicleInspection's
   * collateral-asset signal. `requiredDailyRwf` is snapshotted from `Loan.dailyRwf` at
   * the moment of recording, never read live later, so a loan restructured afterwards
   * cannot silently rewrite what was actually required of a past day.
   */
  async recordLoanSavings(
    loanId: string,
    dto: CreateLoanSavingsEntryDto,
    adminUserId: string,
    auditContext: RequestAuditContext = {},
  ) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException('Loan not found');

    const entry = await this.prisma.loanSavingsEntry.upsert({
      where: { loanId_date: { loanId, date: new Date(dto.date) } },
      update: { depositedRwf: dto.depositedRwf },
      create: {
        loanId,
        date: new Date(dto.date),
        depositedRwf: dto.depositedRwf,
        requiredDailyRwf: loan.dailyRwf,
      },
    });

    await this.auditService.record({
      userId: adminUserId,
      action: 'loan-savings:recorded',
      entity: 'LoanSavingsEntry',
      entityId: entry.id,
      metadata: { loanId, date: dto.date, depositedRwf: dto.depositedRwf },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });

    return entry;
  }

  private async getRequestOrThrow(id: string) {
    const request = await this.prisma.financingRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException('Financing request not found');
    }
    return request;
  }

  private async notifyBuyer(
    userId: string,
    input: {
      title: string;
      body: string;
      requestId: string;
      status: FinancingStatus;
    },
  ) {
    await this.notificationsService.send({
      userId,
      type: NotificationType.FINANCING_UPDATE,
      title: input.title,
      body: input.body,
      metadata: { requestId: input.requestId, status: input.status },
    });
  }

  private toBuyerResponse(
    request: Prisma.FinancingRequestGetPayload<{
      include: typeof financingInclude;
    }>,
  ) {
    const { reviewNotes: _reviewNotes, ...safe } = request;
    return {
      ...safe,
      message:
        'Financing support available upon request. Uza Mobility facilitates document preparation; lending decisions are made by partner institutions.',
    };
  }
}
