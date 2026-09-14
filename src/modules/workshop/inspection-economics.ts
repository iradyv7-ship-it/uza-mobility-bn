/**
 * The monthly (or quarterly) inspection, worked through as arithmetic — see the Mobility
 * Ecosystem Blueprint, Section 06, for the full reasoning. Restated here in one place so
 * both the daily savings target and the inspection due-date cadence read from the same
 * numbers, rather than one hardcoding "30 days" and the other hardcoding "500 RWF"
 * independently and drifting apart.
 *
 * The core identity: 12 inspections a year for a USED car, 4 for a NEW one. 12 ÷ 4 = 3,
 * so a daily savings rate has to scale by that same ratio to land on the full inspection
 * cost by the time each one comes due.
 *
 * ⚠ ASSUMPTION, not negotiated: the 15,000 RWF contracted rate and the 85/15 garage/UZA
 * split below are the blueprint's own proposed structure, reasoned from "a scheduled
 * checklist visit costs a garage less to deliver than an unknown-fault diagnosis." They
 * are not yet agreed with any real garage partner — see the blueprint's Section 13, open
 * question 3.
 *
 * CONTRACTED_INSPECTION_RATE_RWF below is only the seeded default. The live rate is a
 * Platform Setting (`PlatformSettingsService.getInspectionRateRwf()`, key
 * `inspectionRateRwf`) a SUPER_ADMIN can edit from Admin → Platform Settings the moment a
 * real rate is negotiated — no deploy needed. Every function here still takes the rate as
 * a plain parameter (never reaches into the database itself), so it stays a pure,
 * unit-testable rules file; callers are responsible for fetching the current rate first.
 */

import type { VehicleUnitCondition } from '@prisma/client';

/** How many of these a vehicle needs per year, by unit condition at financing. */
export const INSPECTIONS_PER_YEAR: Record<VehicleUnitCondition, number> = {
  USED: 12,
  NEW: 4,
};

/** Calendar days between inspections — 365 / inspections-per-year, rounded to a clean cycle. */
export const INSPECTION_CYCLE_DAYS: Record<VehicleUnitCondition, number> = {
  USED: 30,
  NEW: 90,
};

/** ⚠ ASSUMPTION — see this file's header comment. Not yet negotiated with a real garage. */
export const CONTRACTED_INSPECTION_RATE_RWF = 15_000;

/** ⚠ ASSUMPTION — the blueprint's proposed split of the contracted rate. */
export const GARAGE_SHARE_BPS = 8_500; // 85%
export const UZA_PLATFORM_FEE_BPS = 1_500; // 15%

export interface InspectionEconomics {
  condition: VehicleUnitCondition;
  inspectionsPerYear: number;
  cycleDays: number;
  contractedRateRwf: number;
  /** What a driver sets aside each day so the full contracted rate is on hand by the next
   * inspection's due date — never a surprise bill. Rounded up, same reasoning as the loan
   * daily-target calculation: being short is the borrower's problem, not the spreadsheet's. */
  dailyReserveRwf: number;
  garageTakeHomeRwf: number;
  uzaPlatformFeeRwf: number;
}

/**
 * The full picture for one vehicle's inspection cycle. `Math.ceil` on the daily figure
 * for the same reason `loan-terms.ts`'s `quoteLoan` rounds its daily figure up: an
 * under-collecting daily target is a shortfall waiting to happen, and the safe direction
 * to round is toward collecting slightly more, never less.
 */
/** The garage/UZA split of one contracted inspection fee — the same split regardless of
 * vehicle condition, since it's priced on "scheduled visit vs. unknown-fault diagnosis,"
 * not on how often the vehicle is seen. */
function splitContractedRate(contractedRateRwf: number): {
  garageTakeHomeRwf: number;
  uzaPlatformFeeRwf: number;
} {
  const garageTakeHomeRwf = Math.round(
    (contractedRateRwf * GARAGE_SHARE_BPS) / 10_000,
  );
  return {
    garageTakeHomeRwf,
    uzaPlatformFeeRwf: contractedRateRwf - garageTakeHomeRwf,
  };
}

export function inspectionEconomicsFor(
  condition: VehicleUnitCondition,
  contractedRateRwf: number = CONTRACTED_INSPECTION_RATE_RWF,
): InspectionEconomics {
  const cycleDays = INSPECTION_CYCLE_DAYS[condition];
  const dailyReserveRwf = Math.ceil(contractedRateRwf / cycleDays);

  return {
    condition,
    inspectionsPerYear: INSPECTIONS_PER_YEAR[condition],
    cycleDays,
    contractedRateRwf,
    dailyReserveRwf,
    ...splitContractedRate(contractedRateRwf),
  };
}

/** The next inspection due date, cadence-aware — replaces a flat "always 30 days." */
export function nextInspectionDue(
  inspectedAt: Date,
  condition: VehicleUnitCondition,
): Date {
  const cycleDays = INSPECTION_CYCLE_DAYS[condition];
  return new Date(inspectedAt.getTime() + cycleDays * 24 * 60 * 60 * 1000);
}

/**
 * What UZA's platform fee across N filed inspections actually is — the "real, boring,
 * compounding revenue line" the blueprint names in Section 06. A pure roll-up over
 * however many inspections already exist; this file never counts them itself.
 */
export function garageNetworkRevenue(
  filedInspectionCount: number,
  contractedRateRwf: number = CONTRACTED_INSPECTION_RATE_RWF,
): {
  garageTakeHomeRwf: number;
  uzaPlatformFeeRwf: number;
  totalCollectedRwf: number;
} {
  const perInspection = splitContractedRate(contractedRateRwf);
  return {
    garageTakeHomeRwf: perInspection.garageTakeHomeRwf * filedInspectionCount,
    uzaPlatformFeeRwf: perInspection.uzaPlatformFeeRwf * filedInspectionCount,
    totalCollectedRwf: contractedRateRwf * filedInspectionCount,
  };
}
