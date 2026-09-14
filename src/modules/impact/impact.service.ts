import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { garageNetworkRevenue } from '../workshop/inspection-economics';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

/**
 * One shared impact ledger, read many ways — Mobility Ecosystem Blueprint, Section 10:
 * "a fact is written once, at its source, and every audience reads a view over the same
 * ledger rather than each department keeping its own spreadsheet that inevitably
 * disagrees with the others."
 *
 * Deliberately NOT a new fact-storage table. uza-nexus's real register/intake pattern
 * (Signal → Initiative) is "one dedicated table per fact type, written once, read many
 * ways" — and every fact this module reports on already has exactly that dedicated table
 * in this schema: a training completion is an `Enrolment`, a loan is a `Loan`, an
 * inspection is a `VehicleInspection`, collateral bridged is a `CollateralEntry`. Building
 * a second, parallel "ImpactFact" table that duplicates what those already record would
 * be exactly the kind of drift the blueprint is warning against. This service is the
 * projection layer only — the same discipline `LenderService` already applies reading
 * `Loan` into a bank's view, extended to the funder and investor views the bank-facing
 * code was never meant to serve.
 *
 * The bank's own view is intentionally NOT duplicated here — Section 10's own table says
 * the bank reads "everything Section 03's screening and Section 06's inspections already
 * produce, scoped to only that bank's own borrowers," which is exactly what
 * `LenderController` already serves. Re-exposing it here would be the second copy this
 * whole module exists to avoid.
 */
@Injectable()
export class ImpactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  /**
   * The funder/DFI view: aggregate, anonymised, no borrower ever named. "UZA Empower
   * trained 340 drivers, 60% women, and unlocked RWF 43M in collateral bridging" — the
   * fundable, measurable social-program story Section 02 says gets lost when Empower's
   * numbers are buried inside Mobility's commercial book.
   */
  async funderSummary() {
    const [
      cohortsCount,
      enrolments,
      evsFinanced,
      techniciansCertified,
      collateralPledged,
    ] = await Promise.all([
      this.prisma.cohort.count(),
      this.prisma.enrolment.findMany({
        select: { userId: true, cohortId: true, status: true },
      }),
      this.prisma.loan.count({
        where: {
          status: { in: ['DISBURSED', 'ACTIVE', 'IN_ARREARS', 'CLOSED'] },
        },
      }),
      this.prisma.certificate.count({ where: { revokedAt: null } }),
      this.prisma.collateralEntry.aggregate({
        where: { kind: 'PLEDGED' },
        _sum: { amountRwf: true },
      }),
    ]);

    const { womenPct, youthPct } = await this.genderAndAgeMix(enrolments);
    const totalKmRecorded = await this.totalKmRecorded();

    return {
      cohortsCount,
      traineesEnrolled: enrolments.length,
      traineesCompleted: enrolments.filter((e) => e.status === 'COMPLETED')
        .length,
      womenPct,
      youthPct,
      evsFinanced,
      techniciansCertified,
      collateralBridgedRwf: collateralPledged._sum.amountRwf ?? 0,
      totalKmRecorded,
      gaps: {
        emissionsAvoided:
          'Not computed — converting totalKmRecorded to CO2 avoided needs a cited emissions factor (grid mix + displaced-ICE baseline), which this pass does not have. totalKmRecorded is the real underlying number; apply a sourced factor to it rather than trusting a number invented here.',
      },
    };
  }

  /**
   * The investor view: the commercial story, built from the same facts as the funder
   * view — never a separately-maintained deck that can quietly contradict it.
   */
  async investorSummary() {
    const [loanStats, inspectionsFiled] = await Promise.all([
      this.prisma.loan.aggregate({
        _count: true,
        _sum: { principalRwf: true, outstandingRwf: true, arrearsRwf: true },
        _avg: { principalRwf: true },
      }),
      this.prisma.vehicleInspection.count(),
    ]);

    const activeLoans = await this.prisma.loan.count({
      where: { status: { in: ['DISBURSED', 'ACTIVE', 'IN_ARREARS'] } },
    });
    // Whatever a SUPER_ADMIN currently has set in Platform Settings, not the old hardcoded
    // 15,000 constant — the revenue roll-up has to reflect the real, current rate.
    const inspectionRateRwf =
      await this.platformSettingsService.getInspectionRateRwf();

    return {
      loansOriginated: loanStats._count,
      loansActiveOrDisbursed: activeLoans,
      totalPrincipalRwf: loanStats._sum.principalRwf ?? 0,
      averagePrincipalRwf: Math.round(loanStats._avg.principalRwf ?? 0),
      outstandingRwf: loanStats._sum.outstandingRwf ?? 0,
      arrearsRwf: loanStats._sum.arrearsRwf ?? 0,
      inspectionsFiled,
      garageNetworkRevenue: garageNetworkRevenue(
        inspectionsFiled,
        inspectionRateRwf,
      ),
      gaps: {
        chargingNetworkHealth:
          'Not included — charging-network utilisation lives in uza-charge, a separate system not touched in this pass. Aggregating it here would mean either faking the number or reaching into another repo’s database directly; neither is done.',
      },
    };
  }

  /** Real km driven, from inspection mileage deltas — the one number that's the current
   * proxy for "kilometers driven electric" until it's worth a cited emissions conversion. */
  private async totalKmRecorded(): Promise<number> {
    const rows = await this.prisma.vehicleInspection.findMany({
      where: { mileageKm: { not: null } },
      orderBy: { inspectedAt: 'asc' },
      select: { loanId: true, mileageKm: true },
    });

    const firstByLoan = new Map<string, number>();
    const lastByLoan = new Map<string, number>();
    for (const row of rows) {
      const km = row.mileageKm!;
      if (!firstByLoan.has(row.loanId)) firstByLoan.set(row.loanId, km);
      lastByLoan.set(row.loanId, km);
    }

    let total = 0;
    for (const [loanId, first] of firstByLoan) {
      const last = lastByLoan.get(loanId)!;
      if (last > first) total += last - first;
    }
    return total;
  }

  /**
   * Women/youth mix from the FundApplication each enrolled user traces back to, where one
   * exists. `FundApplication` has no `userId` — it's keyed by `uzaId` (nullable until the
   * applicant is resolved to an account), so this joins Enrolment → User.uzaId →
   * FundApplication.uzaId rather than assuming a direct foreign key that doesn't exist. A
   * user with no matching application, or no uzaId yet, simply doesn't count toward
   * either percentage rather than being guessed at.
   */
  private async genderAndAgeMix(
    enrolments: { userId: string; cohortId: string }[],
  ): Promise<{ womenPct: number | null; youthPct: number | null }> {
    if (enrolments.length === 0) return { womenPct: null, youthPct: null };

    const userIds = [...new Set(enrolments.map((e) => e.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, uzaId: { not: null } },
      select: { uzaId: true },
    });
    const uzaIds = users.map((u) => u.uzaId!).filter(Boolean);
    if (uzaIds.length === 0) return { womenPct: null, youthPct: null };

    const applications = await this.prisma.fundApplication.findMany({
      where: { uzaId: { in: uzaIds } },
      select: { gender: true, dateOfBirth: true },
    });

    let genderKnown = 0;
    let women = 0;
    let ageKnown = 0;
    let youth = 0;
    const now = Date.now();
    const YOUTH_MAX_AGE = 35; // Rwanda's own youth-policy definition (age 16-35).

    for (const app of applications) {
      if (app.gender) {
        genderKnown += 1;
        if (app.gender === 'FEMALE') women += 1;
      }
      if (app.dateOfBirth) {
        const ageYears =
          (now - app.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        ageKnown += 1;
        if (ageYears <= YOUTH_MAX_AGE) youth += 1;
      }
    }

    return {
      womenPct:
        genderKnown > 0 ? Math.round((women / genderKnown) * 1000) / 10 : null,
      youthPct:
        ageKnown > 0 ? Math.round((youth / ageKnown) * 1000) / 10 : null,
    };
  }
}
