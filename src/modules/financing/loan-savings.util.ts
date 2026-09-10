/**
 * The ongoing-behaviour signal UZA Empower gives a lender alongside VehicleInspection's
 * collateral-asset signal: is this borrower consistently meeting, or exceeding, the daily
 * figure their loan actually requires?
 *
 * Pulled out as a pure function for the same reason job-card.state.ts, mechanic-pool.ts
 * and workshop-kpi.ts are pure functions rather than inline service code — this is the
 * one number a lender's credit officer actually reads, so it needs to be exactly right
 * and easy to verify without a database.
 */

export interface SavingsEntryInput {
  readonly date: string;
  readonly depositedRwf: number;
  readonly requiredDailyRwf: number;
}

export interface SavingsEntrySummary extends SavingsEntryInput {
  readonly cumulativeSurplusRwf: number;
}

export interface SavingsSummary {
  readonly entries: readonly SavingsEntrySummary[];
  readonly cumulativeSurplusRwf: number;
  readonly daysRecorded: number;
}

/**
 * Running surplus/shortfall against what was required each day, in date order.
 *
 * Positive means the borrower has, in total, deposited more than required — the signal
 * that they may support more credit, not just service this loan. Negative means they are
 * behind. Entries are not re-sorted defensively: the caller (a database query ordered by
 * date) owns that, and re-sorting here would hide a caller bug instead of surfacing it.
 */
export function summarizeSavings(
  entries: readonly SavingsEntryInput[],
): SavingsSummary {
  let cumulativeSurplusRwf = 0;
  const summarized = entries.map((entry) => {
    cumulativeSurplusRwf += entry.depositedRwf - entry.requiredDailyRwf;
    return { ...entry, cumulativeSurplusRwf };
  });

  return {
    entries: summarized,
    cumulativeSurplusRwf,
    daysRecorded: entries.length,
  };
}
