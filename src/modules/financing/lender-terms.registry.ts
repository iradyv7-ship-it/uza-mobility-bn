import type { RateBand } from './loan-terms';
import { UNGUKA_RATE_BANDS } from './loan-terms';

/**
 * Each lender's commercial terms as data, so a scenario can be studied "depending on the
 * bank the client is going to work with" without a code change per bank.
 *
 * Evidence discipline (nexus CLAUDE.md): every figure carries its source, date and
 * confidence. A lender whose rate is not on file has `rateBands: null` — the engine will
 * size the split (10%, UZA, bank) but will NOT quote a daily figure until someone types a
 * rate in, and it says so. Quoting a rate a lender never agreed to is worse than declining.
 */
export interface LenderTerms {
  readonly key: string;
  readonly name: string;
  /** Null: no agreed rate on file — the engine refuses to quote a schedule without an override. */
  readonly rateBands: readonly RateBand[] | null;
  /** The contribution the lender expects, as % of the vehicle price (client + UZA together). */
  readonly contributionPct: number;
  /** Tenors the lender offers, months. */
  readonly tenorsMonths: readonly number[];
  /** Whether UZA Empower's cash-collateral facility is available with this lender. */
  readonly uzaCollateralAvailable: boolean;
  readonly evidence: {
    readonly source: string;
    readonly date: string;
    readonly confidence: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED';
    readonly note?: string;
  };
}

export const LENDER_TERMS: readonly LenderTerms[] = [
  {
    key: 'unguka',
    name: 'Unguka Bank (LOLC)',
    rateBands: UNGUKA_RATE_BANDS,
    contributionPct: 10,
    tenorsMonths: [36, 60],
    uzaCollateralAvailable: true,
    evidence: {
      source:
        'Rates: Yves, 31 Aug 2026 (not published by Unguka). 10% at every price incl. BYD: written confirmation from Paulin (Unguka), 20 Sept 2026.',
      date: '2026-09-20',
      confidence: 'VERIFIED',
      note: 'Rate bands remain founder-stated; confirm in the facility agreement.',
    },
  },
  {
    key: 'equity',
    name: 'Equity Bank Rwanda',
    rateBands: null,
    contributionPct: 10,
    tenorsMonths: [36, 48, 60],
    uzaCollateralAvailable: false,
    evidence: {
      source: 'No agreed terms on file. Contribution shown as a 10% placeholder for study only.',
      date: '2026-09-20',
      confidence: 'UNVERIFIED',
    },
  },
  {
    key: 'ncba',
    name: 'NCBA Rwanda',
    rateBands: null,
    contributionPct: 10,
    tenorsMonths: [36, 48, 60],
    uzaCollateralAvailable: false,
    evidence: {
      source: 'No agreed terms on file. Contribution shown as a 10% placeholder for study only.',
      date: '2026-09-20',
      confidence: 'UNVERIFIED',
    },
  },
] as const;

export function findLenderTerms(key: string): LenderTerms | undefined {
  const k = key.trim().toLowerCase();
  return LENDER_TERMS.find((l) => l.key === k);
}
