import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPREHENSION_PASS_PCT } from '../academy/academy.rules';
import {
  contributionProgress,
  performance,
  type LedgerLine,
} from '../wallet/wallet.rules';
import { commitment, type Commitment, type CommitmentSignals } from './commitment.rules';
import { driverMinimumRwf } from './empower-support.rules';

/**
 * Reads the commitment signals from what the platform already records — nothing is asked
 * of the driver twice — and runs the ladder. One person at a time for the driver's own
 * view; the whole client base, sorted by rung, for staff.
 */
@Injectable()
export class CommitmentService {
  constructor(private readonly prisma: PrismaService) {}

  async signalsFor(userId: string, now = new Date()): Promise<{ signals: CommitmentSignals; user: { id: string; uzaId: string | null; email: string; name: string } }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, uzaId: true, email: true, phone: true, firstName: true, lastName: true, isEmailVerified: true, isPhoneVerified: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [application, loan, wallet, enrolments, lead] = await Promise.all([
      user.uzaId
        ? this.prisma.fundApplication.findFirst({
            where: { uzaId: user.uzaId },
            orderBy: { createdAt: 'desc' },
            select: { status: true, signedAt: true, nationalId: true, licenceNumber: true, averageDailyTakingsRwf: true, workingDaysPerWeek: true, preferredTenorMonths: true },
          })
        : null,
      this.prisma.loan.findFirst({ where: { borrowerUserId: user.id }, orderBy: { createdAt: 'desc' }, select: { vehiclePriceRwf: true } }),
      this.prisma.wallet.findUnique({ where: { userId: user.id }, select: { id: true, dailyTargetRwf: true, contributionTargetRwf: true } }),
      this.prisma.enrolment.findMany({
        where: { userId: user.id },
        select: { attendance: { select: { id: true } }, assessments: { where: { kind: 'COMPREHENSION' }, select: { scorePct: true } } },
      }),
      user.phone ? this.prisma.driverInterestLead.findFirst({ where: { phone: user.phone }, select: { id: true } }) : null,
    ]);

    let confirmedDeposits = 0, currentStreak = 0, longestStreak = 0, contributionTotalRwf = 0;
    if (wallet) {
      const rows = await this.prisma.ledgerEntry.findMany({ where: { walletId: wallet.id }, orderBy: { occurredAt: 'asc' } });
      // amountRwf is a BigInt column; the rules work in numbers.
      const lines: LedgerLine[] = rows.map((r) => ({
        bucket: r.bucket ?? null,
        direction: r.direction,
        amountRwf: Number(r.amountRwf),
        occurredAt: r.occurredAt,
        confirmedAt: r.confirmedAt,
        recordedBy: r.recordedBy,
        reason: r.reason,
      }));
      const perf = performance(lines, wallet.dailyTargetRwf, wallet.contributionTargetRwf, now);
      const credits = await this.prisma.contributionCredit.aggregate({ where: { userId: user.id, revokedAt: null }, _sum: { amountRwf: true } });
      const prog = contributionProgress(perf, lines, wallet.contributionTargetRwf, credits._sum.amountRwf ?? 0);
      confirmedDeposits = lines.filter((l) => l.direction === 'CREDIT' && l.confirmedAt).length;
      currentStreak = perf.currentStreak;
      longestStreak = perf.longestStreak;
      contributionTotalRwf = prog.totalRwf;
    }

    const price = loan?.vehiclePriceRwf ?? null;
    const clientMinimumRwf = price ? driverMinimumRwf(price) : (wallet?.contributionTargetRwf ?? null);

    const signals: CommitmentSignals = {
      emailVerified: user.isEmailVerified,
      phoneVerified: user.isPhoneVerified,
      hasChosenVehicle: !!loan || !!lead || application?.preferredTenorMonths != null || !!wallet?.contributionTargetRwf,
      declaredIncome: (application?.averageDailyTakingsRwf ?? 0) > 0 && (application?.workingDaysPerWeek ?? 0) > 0,
      attendedOrientation: enrolments.some((e) => e.attendance.length > 0),
      walletOpened: !!wallet,
      confirmedDeposits,
      currentStreak,
      longestStreak,
      documentsComplete: !!application?.nationalId?.trim() && !!application?.licenceNumber?.trim(),
      comprehensionPassed: enrolments.some((e) => e.assessments.some((a) => a.scorePct >= COMPREHENSION_PASS_PCT)),
      contributionTotalRwf,
      clientMinimumRwf,
      fundApplicationSigned: !!application?.signedAt || ['SUBMITTED', 'SCREENING', 'ACCEPTED'].includes(application?.status ?? ''),
    };
    return { signals, user: { id: user.id, uzaId: user.uzaId, email: user.email, name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() } };
  }

  async forUser(userId: string): Promise<Commitment & { signals: CommitmentSignals }> {
    const { signals } = await this.signalsFor(userId);
    return { ...commitment(signals), signals };
  }

  /** Every client (BUYER without a staff role), highest rung first. Staff view. */
  async ladder(limit = 200) {
    const buyers = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null, roles: { some: { role: { name: 'BUYER' } } } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const rows = await Promise.all(
      buyers.map(async (b) => {
        const { signals, user } = await this.signalsFor(b.id);
        const c = commitment(signals);
        return { user, stage: c.stage, rung: c.rung, staffTime: c.staffTime, next: c.next, evidence: c.evidence, streak: signals.currentStreak, contributionTotalRwf: signals.contributionTotalRwf, clientMinimumRwf: signals.clientMinimumRwf };
      }),
    );
    rows.sort((a, b) => b.rung - a.rung || b.streak - a.streak);
    const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.stage] = (m[r.stage] ?? 0) + 1), m), {});
    return { counts, rows };
  }
}
