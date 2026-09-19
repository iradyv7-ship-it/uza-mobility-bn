import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  normaliseRepaymentRows,
  service,
  type RepaymentRow,
} from './loan-servicing.rules';

/**
 * What happens to a loan after the bank says yes.
 *
 * Until this existed, a loan's balance and arrears were the numbers written at origination,
 * for ever. The lender's portal, the covenant engine and the impact views all read them, so
 * they were all reading a quote. This service is the only writer of `paidRwf`,
 * `outstandingRwf`, `arrearsRwf`, `disbursedAt` and `closedAt`, and it writes them from a
 * record of repayments — the bank's file first, a typed receipt second.
 *
 * Every repayment also lands in the borrower's wallet as an INSTALMENT_SWEEP debit from the
 * LOAN bucket, so the driver's statement shows the money leaving on the day the bank says it
 * did — the wallet stays a faithful view of the driver's own account, which is its whole
 * legal footing.
 */
@Injectable()
export class LoanServicingService {
  private readonly logger = new Logger(LoanServicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Disbursement ──────────────────────────────────────────────────────────────────────

  async disburse(input: {
    loanId: string;
    disbursedAt?: Date;
    reference?: string;
    byUserId: string;
  }) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: input.loanId },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.disbursedAt) {
      throw new BadRequestException(
        `${loan.reference} was already disbursed on ${loan.disbursedAt.toISOString().slice(0, 10)}.`,
      );
    }
    if (loan.status !== 'APPROVED') {
      throw new BadRequestException(
        `Only an APPROVED loan can be disbursed; ${loan.reference} is ${loan.status}.`,
      );
    }
    const disbursedAt = input.disbursedAt ?? new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: 'DISBURSED',
          disbursedAt,
          // From here "balance" means what remains to be repaid, interest included.
          outstandingRwf: loan.totalRepayableRwf,
          arrearsRwf: 0,
        },
      });
      // The daily target the driver lives by is the lender's daily figure. If the wallet
      // was opened before the loan was quoted, it may still be empty; set it now.
      await tx.wallet.updateMany({
        where: { userId: loan.borrowerUserId, dailyTargetRwf: null },
        data: { dailyTargetRwf: loan.dailyRwf },
      });
      return u;
    });

    await this.audit.record({
      userId: input.byUserId,
      action: 'LOAN_DISBURSED',
      entity: 'loan',
      entityId: loan.id,
      metadata: {
        reference: loan.reference,
        disbursedAt: disbursedAt.toISOString(),
        bankReference: input.reference ?? null,
        totalRepayableRwf: loan.totalRepayableRwf,
        monthlyRwf: loan.monthlyRwf,
        dailyRwf: loan.dailyRwf,
      },
    });
    await this.notifications.send({
      userId: loan.borrowerUserId,
      type: NotificationType.SYSTEM_ALERT,
      title: 'Inguzanyo yawe yatanzwe · Your loan has been disbursed',
      body: `Intego ya buri munsi: RWF ${loan.dailyRwf.toLocaleString('en-RW')}. Ubwishyu bwa mbere ni mu minsi 30. · Daily target RWF ${loan.dailyRwf.toLocaleString('en-RW')}; the first instalment is due in 30 days.`,
      metadata: { loanId: loan.id },
    });
    return updated;
  }

  // ── Repayments ────────────────────────────────────────────────────────────────────────

  async recordRepayment(input: {
    loanId: string;
    amountRwf: number;
    paidAt: Date;
    reference: string;
    source: 'LENDER_FILE' | 'MANUAL' | 'SWEEP';
    note?: string;
    byUserId: string | null;
  }) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: input.loanId },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!loan.disbursedAt) {
      throw new BadRequestException(
        `${loan.reference} has not been disbursed; a repayment cannot precede the loan.`,
      );
    }
    if (loan.closedAt) {
      throw new BadRequestException(`${loan.reference} is closed.`);
    }
    if (!Number.isInteger(input.amountRwf) || input.amountRwf <= 0) {
      throw new BadRequestException(
        'A repayment is a positive whole number of francs.',
      );
    }
    const reference = input.reference.trim();
    if (!reference)
      throw new BadRequestException('The bank reference is required.');

    const existing = await this.prisma.loanRepayment.findUnique({
      where: { loanId_reference: { loanId: loan.id, reference } },
    });
    if (existing) return { repayment: existing, duplicate: true, loan };

    const repayment = await this.prisma.$transaction(async (tx) => {
      const r = await tx.loanRepayment.create({
        data: {
          loanId: loan.id,
          amountRwf: input.amountRwf,
          paidAt: input.paidAt,
          reference,
          source: input.source,
          recordedByUserId: input.byUserId,
          note: input.note?.trim() || null,
        },
      });
      // The driver's own statement: the instalment left the account for the lender.
      const wallet = await tx.wallet.findUnique({
        where: { userId: loan.borrowerUserId },
      });
      if (wallet) {
        const balanceAfter = wallet.balanceRwf - BigInt(input.amountRwf);
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceRwf: balanceAfter },
        });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            direction: 'DEBIT',
            reason: 'INSTALMENT_SWEEP',
            amountRwf: BigInt(input.amountRwf),
            balanceAfterRwf: balanceAfter,
            reserveBalanceAfterRwf: wallet.reserveBalanceRwf,
            idempotencyKey: `sweep:${r.id}`,
            externalRef: reference,
            bucket: 'LOAN',
            recordedBy: 'INSTITUTION',
            confirmedAt: input.paidAt,
            confirmedRef: reference,
            occurredAt: input.paidAt,
            note: `Ubwishyu bw'inguzanyo ${loan.reference} · Instalment to the lender`,
          },
        });
      }
      return r;
    });

    const serviced = await this.recompute(loan.id, new Date());
    await this.audit.record({
      userId: input.byUserId,
      action: 'LOAN_REPAYMENT_RECORDED',
      entity: 'loan',
      entityId: loan.id,
      metadata: {
        repaymentId: repayment.id,
        amountRwf: input.amountRwf,
        paidAt: input.paidAt.toISOString(),
        reference,
        source: input.source,
        after: serviced,
      },
    });
    return { repayment, duplicate: false, loan: serviced };
  }

  async listRepayments(loanId: string) {
    return this.prisma.loanRepayment.findMany({
      where: { loanId },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** The bank's repayment file. Idempotent: rows already recorded are counted, not duplicated. */
  async importRepayments(
    rows: Record<string, unknown>[],
    byUserId: string,
    source: 'LENDER_FILE' | 'SWEEP' = 'LENDER_FILE',
  ) {
    const { ok, errors } = normaliseRepaymentRows(rows);
    const refs = [...new Set(ok.map((r) => r.loanRef))];
    const loans = await this.prisma.loan.findMany({
      where: { reference: { in: refs } },
      select: { id: true, reference: true },
    });
    const byRef = new Map(loans.map((l) => [l.reference, l.id]));

    let imported = 0;
    let duplicates = 0;
    const failed: { row: RepaymentRow; problem: string }[] = [];
    for (const row of ok) {
      const loanId = byRef.get(row.loanRef);
      if (!loanId) {
        failed.push({ row, problem: `no loan with reference ${row.loanRef}` });
        continue;
      }
      try {
        const r = await this.recordRepayment({
          loanId,
          amountRwf: row.amountRwf,
          paidAt: row.paidAt,
          reference: row.reference,
          source,
          byUserId,
        });
        if (r.duplicate) duplicates += 1;
        else imported += 1;
      } catch (e) {
        failed.push({
          row,
          problem: e instanceof Error ? e.message : String(e),
        });
      }
    }
    await this.audit.record({
      userId: byUserId,
      action: 'LOAN_REPAYMENTS_IMPORTED',
      entity: 'loan',
      metadata: {
        rows: rows.length,
        imported,
        duplicates,
        failed: failed.length,
        parseErrors: errors.length,
      },
    });
    return {
      rows: rows.length,
      imported,
      duplicates,
      failed,
      parseErrors: errors,
    };
  }

  // ── Arrears ───────────────────────────────────────────────────────────────────────────

  /** Recompute one loan from its repayments. Returns the loan as it now stands. */
  async recompute(loanId: string, now = new Date()) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!loan.disbursedAt) return loan;

    const paid = await this.prisma.loanRepayment.aggregate({
      where: { loanId },
      _sum: { amountRwf: true },
    });
    const paidRwf = paid._sum.amountRwf ?? 0;
    const s = service({
      totalRepayableRwf: loan.totalRepayableRwf,
      monthlyRwf: loan.monthlyRwf,
      tenorMonths: loan.tenorMonths,
      paidRwf,
      disbursedAt: loan.disbursedAt,
      closedAt: loan.closedAt,
      now,
    });
    return this.prisma.loan.update({
      where: { id: loanId },
      data: {
        paidRwf,
        outstandingRwf: s.outstandingRwf,
        arrearsRwf: s.arrearsRwf,
        status: s.status,
      },
    });
  }

  /** Every live loan, every night, before the 05:00 covenant run reads the result. */
  @Cron('30 4 * * *')
  async nightlyRecompute() {
    const r = await this.recomputeAll();
    this.logger.log(
      `Nightly servicing: ${r.loans} loans, ${r.inArrears} in arrears`,
    );
    return r;
  }

  async recomputeAll(now = new Date()) {
    const live = await this.prisma.loan.findMany({
      where: { disbursedAt: { not: null }, closedAt: null },
      select: { id: true },
    });
    let inArrears = 0;
    for (const l of live) {
      const u = await this.recompute(l.id, now);
      if (u.arrearsRwf > 0) inArrears += 1;
    }
    return { loans: live.length, inArrears, at: now.toISOString() };
  }

  // ── Closure ───────────────────────────────────────────────────────────────────────────

  async close(input: { loanId: string; note?: string; byUserId: string }) {
    const loan = await this.recompute(input.loanId, new Date());
    if (!loan.disbursedAt) {
      throw new BadRequestException(
        'A loan that was never disbursed is withdrawn, not closed.',
      );
    }
    if (loan.closedAt)
      throw new BadRequestException(`${loan.reference} is already closed.`);
    if (loan.outstandingRwf > 0 && !input.note?.trim()) {
      throw new BadRequestException(
        `RWF ${loan.outstandingRwf.toLocaleString('en-RW')} is still outstanding. Closing with a balance needs a written reason (settlement, write-off, restructure into a new loan).`,
      );
    }
    const closedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const u = await tx.loan.update({
        where: { id: loan.id },
        data: { status: 'CLOSED', closedAt, arrearsRwf: 0 },
      });
      // The reserve was the driver's own money, ring-fenced against a bad week. The loan is
      // done; it goes back to them as their own savings, on the statement, today.
      const wallet = await tx.wallet.findUnique({
        where: { userId: loan.borrowerUserId },
      });
      let reserveReturnedRwf = 0n;
      if (wallet && wallet.reserveBalanceRwf > 0n) {
        reserveReturnedRwf = wallet.reserveBalanceRwf;
        const balanceAfter = wallet.balanceRwf + reserveReturnedRwf;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceRwf: balanceAfter, reserveBalanceRwf: 0n },
        });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            direction: 'CREDIT',
            reason: 'RESERVE_RETURN',
            amountRwf: reserveReturnedRwf,
            balanceAfterRwf: balanceAfter,
            reserveBalanceAfterRwf: 0n,
            idempotencyKey: `reserve-return:${loan.id}`,
            bucket: 'PERSONAL',
            recordedBy: 'INSTITUTION',
            confirmedAt: closedAt,
            occurredAt: closedAt,
            note: `Inguzanyo ${loan.reference} yarangiye — ubwizigame bwawe bwagarutse · Loan closed; your reserve returned`,
          },
        });
      }
      return { loan: u, reserveReturnedRwf: Number(reserveReturnedRwf) };
    });

    await this.audit.record({
      userId: input.byUserId,
      action: 'LOAN_CLOSED',
      entity: 'loan',
      entityId: loan.id,
      metadata: {
        reference: loan.reference,
        outstandingAtCloseRwf: loan.outstandingRwf,
        note: input.note?.trim() || null,
        reserveReturnedRwf: result.reserveReturnedRwf,
      },
    });
    await this.notifications.send({
      userId: loan.borrowerUserId,
      type: NotificationType.SYSTEM_ALERT,
      title: 'Twara. Tunga. — Inguzanyo yawe yarangiye · Your loan is closed',
      body:
        result.reserveReturnedRwf > 0
          ? `Imodoka ni iyawe. Ubwizigame bwawe bwa RWF ${result.reserveReturnedRwf.toLocaleString('en-RW')} bwagarutse mu kigega cyawe. · The car is yours. Your reserve of RWF ${result.reserveReturnedRwf.toLocaleString('en-RW')} is back in your own savings.`
          : 'Imodoka ni iyawe. · The car is yours.',
      metadata: { loanId: loan.id },
    });
    return result;
  }
}
