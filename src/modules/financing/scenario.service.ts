import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { ApplyScenarioDto } from './dto/scenario.dto';
import {
  scenario,
  study,
  type Scenario,
  type ScenarioInput,
  type Study,
} from './scenario.rules';

/**
 * The scenario engine against real loans: read a loan as a scenario, study it, and — for an
 * undisbursed loan — book a scenario onto it. This replaces `scripts/apply-bank-terms.ts`
 * with a route Scorah or a finance admin can use from the panel when a bank moves a number.
 *
 * A disbursed loan is never re-quoted here: from disbursement the schedule is the bank's,
 * and changes go through servicing (repayments) or a tenor change, both of which leave
 * their own trail.
 */
@Injectable()
export class ScenarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The loan's booked numbers, expressed as a scenario input, so the studio opens on them. */
  async inputForLoan(loanId: string): Promise<{
    input: ScenarioInput;
    loan: { id: string; reference: string; disbursedAt: Date | null; status: string };
  }> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { bank: { select: { lenderKey: true } } },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    const pledged = await this.prisma.collateralEntry.aggregate({
      where: { loanId: loan.id, kind: 'PLEDGED' },
      _sum: { amountRwf: true },
    });
    const price = loan.vehiclePriceRwf ?? loan.principalRwf;
    const client = loan.clientContributionRwf ?? 0;
    const uza = pledged._sum.amountRwf ?? 0;
    const input: ScenarioInput = {
      vehiclePriceRwf: price,
      clientContributionRwf: client,
      tenorMonths: loan.tenorMonths,
      lenderKey: loan.bank.lenderKey ?? undefined,
      // The booked split is pinned so the studio opens on what is actually on file, even
      // where that departs from the rule; the studio clears the pins as the user edits.
      uzaCollateralRwf: uza,
      bankLoanRwf: loan.principalRwf,
      // Cohort-1 rows booked below the band are shown against the minimum they were
      // accepted on, not the one that applies from cohort 2.
      grandfatheredMinimumRwf:
        client > 0 && client < 1_000_000 ? client : undefined,
    };
    return {
      input,
      loan: {
        id: loan.id,
        reference: loan.reference,
        disbursedAt: loan.disbursedAt,
        status: loan.status,
      },
    };
  }

  async studyLoan(loanId: string): Promise<Study & { loan: unknown }> {
    const { input, loan } = await this.inputForLoan(loanId);
    return { ...study(input), loan };
  }

  /**
   * Book a scenario onto an undisbursed loan: price, contribution, principal and schedule
   * on the loan; UZA's pledge as the single "Booked terms" PLEDGED entry; the wallet's
   * daily and contribution targets; one audit line with before and after.
   */
  async applyToLoan(
    loanId: string,
    dto: ApplyScenarioDto,
    byUserId: string,
  ): Promise<{ scenario: Scenario; loan: unknown }> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { bank: { select: { lenderKey: true } } },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.disbursedAt) {
      throw new BadRequestException(
        `${loan.reference} is disbursed; the schedule is the bank's now. Use servicing or a tenor change.`,
      );
    }
    if (loan.status === 'CLOSED') {
      throw new BadRequestException(`${loan.reference} is closed.`);
    }

    const s = scenario({ ...dto, lenderKey: dto.lenderKey ?? loan.bank.lenderKey ?? undefined });
    const blocks = s.checks.filter((c) => c.severity === 'block');
    if (blocks.length) {
      throw new BadRequestException({
        message: 'These numbers cannot be booked.',
        checks: s.checks,
      });
    }
    const warns = s.checks.filter((c) => c.severity === 'warn');
    if (warns.length && !dto.acceptWarnings) {
      throw new BadRequestException({
        message:
          'These numbers depart from the rule. Review the warnings and resend with acceptWarnings: true.',
        checks: s.checks,
      });
    }
    if (!s.schedule) {
      throw new BadRequestException('No schedule could be computed.');
    }
    const q = s.schedule;
    const before = {
      vehiclePriceRwf: loan.vehiclePriceRwf,
      clientContributionRwf: loan.clientContributionRwf,
      principalRwf: loan.principalRwf,
      tenorMonths: loan.tenorMonths,
      annualRateBps: loan.annualRateBps,
      monthlyRwf: loan.monthlyRwf,
      dailyRwf: loan.dailyRwf,
      totalRepayableRwf: loan.totalRepayableRwf,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.loan.update({
        where: { id: loan.id },
        data: {
          vehiclePriceRwf: s.inputs.vehiclePriceRwf,
          clientContributionRwf: s.split.clientContributionRwf,
          principalRwf: q.financedRwf,
          tenorMonths: q.tenorMonths,
          annualRateBps: q.annualRateBps,
          monthlyRwf: q.monthlyRwf,
          dailyRwf: q.dailyRwf,
          totalRepayableRwf: q.totalRepayableRwf,
          outstandingRwf: q.financedRwf,
        },
      });

      // One pledge row per loan carries the booked terms. Earlier script-made rows start
      // with "Bank terms"; this one starts with "Booked terms". Whichever exists is updated
      // so the facility total never double-counts a loan.
      const note = `Booked terms ${new Date().toISOString().slice(0, 10)}: client ${s.split.clientContributionRwf.toLocaleString('en-RW')} + UZA cash collateral ${s.split.uzaCollateralRwf.toLocaleString('en-RW')} = ${s.split.coverPctOfPrice}% of ${s.inputs.vehiclePriceRwf.toLocaleString('en-RW')}; bank ${q.financedRwf.toLocaleString('en-RW')}${dto.note ? ` — ${dto.note}` : ''}`;
      const existing = await tx.collateralEntry.findFirst({
        where: {
          loanId: loan.id,
          kind: 'PLEDGED',
          OR: [
            { note: { startsWith: 'Bank terms' } },
            { note: { startsWith: 'Booked terms' } },
          ],
        },
      });
      if (existing) {
        await tx.collateralEntry.update({
          where: { id: existing.id },
          data: { amountRwf: s.split.uzaCollateralRwf, note },
        });
      } else if (s.split.uzaCollateralRwf > 0) {
        await tx.collateralEntry.create({
          data: {
            bankId: loan.bankId,
            loanId: loan.id,
            kind: 'PLEDGED',
            amountRwf: s.split.uzaCollateralRwf,
            note,
          },
        });
      }

      await tx.wallet.updateMany({
        where: { userId: loan.borrowerUserId },
        data: {
          dailyTargetRwf: q.dailyRwf,
          contributionTargetRwf: s.split.clientContributionRwf,
        },
      });
      return u;
    });

    await this.audit.record({
      userId: byUserId,
      action: 'LOAN_TERMS_BOOKED',
      entity: 'loan',
      entityId: loan.id,
      metadata: {
        reference: loan.reference,
        before,
        after: {
          vehiclePriceRwf: s.inputs.vehiclePriceRwf,
          clientContributionRwf: s.split.clientContributionRwf,
          uzaCollateralRwf: s.split.uzaCollateralRwf,
          bankLoanRwf: q.financedRwf,
          tenorMonths: q.tenorMonths,
          annualRateBps: q.annualRateBps,
          monthlyRwf: q.monthlyRwf,
          dailyRwf: q.dailyRwf,
          totalRepayableRwf: q.totalRepayableRwf,
        },
        rule: { ...s.rule },
        checks: s.checks.map((c) => ({ ...c })),
        note: dto.note ?? null,
      },
    });

    return { scenario: s, loan: updated };
  }
}
