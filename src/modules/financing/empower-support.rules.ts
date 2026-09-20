import { BadRequestException } from '@nestjs/common';
import { quoteLoan, UNGUKA_RATE_BANDS } from './loan-terms';

/**
 * What UZA Empower puts in, per client, and in total.
 *
 * This is the fund's arithmetic, and until 12 September 2026 it lived only in the pitch
 * portal. The API screened applicants against a flat placeholder of RWF 1,600,000 while the
 * portal quoted the banded figure Unguka's own contact confirmed. Two systems, two numbers,
 * and the one the bank had seen was the one the API did not know.
 *
 * ── THE RULES, WITH THEIR SOURCE ──────────────────────────────────────────────────────
 *
 *  Contribution band     Vehicle at or below RWF 25,000,000 → 10% of price.
 *                        Above RWF 25,000,000 → 15%.
 *                        Confirmed by Unguka's Tunga Taxi contact, 19 August 2026, in a live
 *                        meeting. Treated as policy. (`unguka-portal` memory; `07-evidence-base`)
 *
 *  Driver minimum        The part of the contribution that must be the driver's own money —
 *                        a programme rule, not the bank's. Below it, UZA does not top up: the
 *                        top-up closes a gap, it does not replace the driver's stake.
 *                        From cohort 2 the minimum is banded by vehicle price (Yves,
 *                        20 September 2026):
 *                            below RWF 20,000,000            → RWF 1,000,000
 *                            RWF 20,000,000 – 24,999,999     → RWF 1,500,000
 *                            RWF 25,000,000 – 30,000,000     → RWF 2,000,000
 *                            above RWF 30,000,000            → RWF 2,500,000
 *                        Cohort 1 was accepted at RWF 500,000 on the E70s — "as the initial
 *                        cohort, we accept that" — and is grandfathered via
 *                        `grandfatheredMinimumRwf` on the row.
 *
 *  UZA Empower support   required contribution − what the driver has, floored at zero.
 *                        Placed as blocked cash collateral (Unguka only), pinned to the loan
 *                        as a PLEDGED CollateralEntry — see `03-credit-enhancement.md`.
 *
 *  Facility              price − required contribution. The bank lends this.
 *
 * Nothing here is a credit decision. It sizes what UZA would need to place if the bank said
 * yes; the bank still says yes or no.
 */

export const BAND_THRESHOLD_RWF = 25_000_000;
export const LOWER_BAND_PCT = 10;
export const UPPER_BAND_PCT = 15;
/** Cohort 1's minimum, kept for the rows that were accepted on it. */
export const COHORT1_DRIVER_MINIMUM_RWF = 500_000;
/** @deprecated Use driverMinimumRwf(price). Kept so older call sites still compile. */
export const DRIVER_MINIMUM_RWF = COHORT1_DRIVER_MINIMUM_RWF;

/**
 * The suggested minimum the client brings themselves, by vehicle price. Shown on every
 * option next to the expected 10% (or 15%) contribution, so a driver choosing between a
 * RWF 18.5M E70 and a RWF 31.5M Yuan Up sees both numbers move together.
 */
export function driverMinimumRwf(vehiclePriceRwf: number): number {
  if (vehiclePriceRwf < 20_000_000) return 1_000_000;
  if (vehiclePriceRwf < 25_000_000) return 1_500_000;
  if (vehiclePriceRwf <= 30_000_000) return 2_000_000;
  return 2_500_000;
}

export function contributionBandPct(vehiclePriceRwf: number): number {
  return vehiclePriceRwf <= BAND_THRESHOLD_RWF
    ? LOWER_BAND_PCT
    : UPPER_BAND_PCT;
}

export function requiredContributionRwf(vehiclePriceRwf: number): number {
  return Math.round(
    (vehiclePriceRwf * contributionBandPct(vehiclePriceRwf)) / 100,
  );
}

/** One row as it arrives — from a spreadsheet, a form, or an application record. */
export interface SupportRowInput {
  /** Anything that identifies the row back to the person: UZA ID, application ref, or a name. */
  reference: string;
  vehicle?: string;
  vehiclePriceRwf: number;
  /**
   * What the driver has, expressed EITHER as an amount OR as a percentage of the required
   * contribution ("they have 40% of the 10%"). If both are given the amount wins and the
   * percentage is checked against it.
   */
  driverHasRwf?: number;
  driverHasPctOfRequired?: number;
  tenorMonths?: 36 | 60;
  /**
   * A minimum accepted for this row that differs from the banded rule — cohort 1's RWF
   * 500,000 on the E70s. Recorded on the row so the plan says which rule it applied.
   */
  grandfatheredMinimumRwf?: number;
}

export interface SupportRowPlan {
  reference: string;
  vehicle: string | null;
  vehiclePriceRwf: number;
  bandPct: number;
  requiredContributionRwf: number;
  /** The suggested minimum the client brings themselves for a vehicle at this price. */
  suggestedDriverMinimumRwf: number;
  /** The minimum actually applied to this row (equals the suggestion unless grandfathered). */
  appliedDriverMinimumRwf: number;
  driverHasRwf: number;
  driverHasPctOfRequired: number;
  /** The gap UZA Empower would place as collateral. Zero when the driver has enough. */
  uzaSupportRwf: number;
  /** price − required contribution: what the bank lends. */
  facilityRwf: number;
  tenorMonths: 36 | 60;
  monthlyRwf: number;
  dailyRwf: number;
  /** True when the driver's own stake is below the programme minimum. Support is NOT computed
   *  as if UZA would make up that part: the row shows what the driver still has to bring. */
  belowDriverMinimum: boolean;
  driverStillNeedsRwf: number;
  notes: string[];
  /** What a bigger stake, or a shorter term, would save THIS driver. The teaching instrument. */
  whatIf: WhatIf;
}

/**
 * One row of the contribution ladder: if the driver brought this much, what would the
 * facility, the daily figure and the total interest be — and what does it save against the
 * baseline row above it?
 */
export interface LadderStep {
  label: string;
  contributionRwf: number;
  contributionPctOfPrice: number;
  facilityRwf: number;
  dailyRwf: number;
  totalInterestRwf: number;
  interestSavedRwf: number;
  dailySavedRwf: number;
}

export interface WhatIf {
  /** Each extra RWF 100,000 of stake saves this much interest over the term, at this tenor. */
  interestSavedPer100kRwf: number;
  /** The ladder: the band minimum, then 20%, 30%, 50% of price. */
  contributionLadder: LadderStep[];
  /** 3 years against 5, for the SAME facility: dearer per day, cheaper in total. */
  tenor: {
    threeYears: { dailyRwf: number; totalInterestRwf: number };
    fiveYears: { dailyRwf: number; totalInterestRwf: number };
    extraPerDayFor3yRwf: number;
    totalSavedBy3yRwf: number;
    /** Working days of extra daily effort it takes to recover... expressed the way a driver hears it. */
    sentence: string;
  };
}

export interface SupportPlan {
  rows: SupportRowPlan[];
  totals: {
    clients: number;
    eligibleForSupport: number;
    belowDriverMinimum: number;
    vehiclesRwf: number;
    requiredContributionRwf: number;
    driverContributionRwf: number;
    /** The number the facility has to be sized to. */
    uzaSupportRwf: number;
    facilityRwf: number;
  };
  assumptions: string[];
}

function assertAmount(name: string, v: number, reference: string) {
  if (!Number.isFinite(v) || v < 0) {
    throw new BadRequestException(
      `${reference}: ${name} must be a non-negative number.`,
    );
  }
}

export function planRow(input: SupportRowInput): SupportRowPlan {
  const ref = input.reference?.trim() || '(no reference)';
  assertAmount('vehiclePriceRwf', input.vehiclePriceRwf, ref);
  if (input.vehiclePriceRwf <= 0) {
    throw new BadRequestException(`${ref}: vehiclePriceRwf must be positive.`);
  }

  const bandPct = contributionBandPct(input.vehiclePriceRwf);
  const required = requiredContributionRwf(input.vehiclePriceRwf);
  const notes: string[] = [];

  let driverHas: number;
  if (input.driverHasRwf !== undefined) {
    assertAmount('driverHasRwf', input.driverHasRwf, ref);
    driverHas = Math.round(input.driverHasRwf);
    if (input.driverHasPctOfRequired !== undefined) {
      const implied = Math.round(
        (required * input.driverHasPctOfRequired) / 100,
      );
      if (Math.abs(implied - driverHas) > 1_000) {
        notes.push(
          `Amount and percentage disagree (RWF ${driverHas.toLocaleString('en-RW')} vs ${input.driverHasPctOfRequired}% = RWF ${implied.toLocaleString('en-RW')}); the amount was used.`,
        );
      }
    }
  } else if (input.driverHasPctOfRequired !== undefined) {
    assertAmount('driverHasPctOfRequired', input.driverHasPctOfRequired, ref);
    if (input.driverHasPctOfRequired > 100) {
      throw new BadRequestException(
        `${ref}: driverHasPctOfRequired cannot exceed 100.`,
      );
    }
    driverHas = Math.round((required * input.driverHasPctOfRequired) / 100);
  } else {
    throw new BadRequestException(
      `${ref}: give either driverHasRwf or driverHasPctOfRequired.`,
    );
  }

  const suggestedMinimum = driverMinimumRwf(input.vehiclePriceRwf);
  const minimum = input.grandfatheredMinimumRwf ?? suggestedMinimum;
  const belowMinimum = driverHas < minimum;
  const driverStillNeeds = belowMinimum ? minimum - driverHas : 0;
  // UZA closes the gap above the driver's minimum stake, never the stake itself.
  const effectiveDriver = Math.max(driverHas, Math.min(minimum, required));
  const uzaSupport = belowMinimum
    ? Math.max(0, required - effectiveDriver)
    : Math.max(0, required - driverHas);

  if (belowMinimum) {
    notes.push(
      `Driver stake RWF ${driverHas.toLocaleString('en-RW')} is below the RWF ${minimum.toLocaleString('en-RW')} minimum; support shown assumes the driver first reaches the minimum.`,
    );
  }
  if (driverHas >= required) {
    notes.push('Driver covers the full contribution; no UZA support needed.');
  }
  if (bandPct === UPPER_BAND_PCT) {
    notes.push(
      `Above RWF ${BAND_THRESHOLD_RWF.toLocaleString('en-RW')}: the 15% band applies. A cheaper vehicle in the 10% band would cut the required contribution by more than the price difference suggests.`,
    );
  }

  const tenor = input.tenorMonths ?? 60;
  const facility = input.vehiclePriceRwf - required;
  const quote = quoteLoan(facility, tenor, UNGUKA_RATE_BANDS);
  const whatIf = whatIfFor(input.vehiclePriceRwf, required, tenor);

  return {
    reference: ref,
    vehicle: input.vehicle?.trim() || null,
    vehiclePriceRwf: Math.round(input.vehiclePriceRwf),
    bandPct,
    requiredContributionRwf: required,
    suggestedDriverMinimumRwf: suggestedMinimum,
    appliedDriverMinimumRwf: minimum,
    driverHasRwf: driverHas,
    driverHasPctOfRequired: Math.round((driverHas / required) * 1000) / 10,
    uzaSupportRwf: uzaSupport,
    facilityRwf: facility,
    tenorMonths: tenor,
    monthlyRwf: quote.monthlyRwf,
    dailyRwf: quote.dailyRwf,
    belowDriverMinimum: belowMinimum,
    driverStillNeedsRwf: driverStillNeeds,
    notes,
    whatIf,
  };
}

/**
 * The lesson in numbers, for one vehicle.
 *
 * Yves, 12 September 2026: part of the training is to make them understand the need to
 * provide their 10% — and, when possible, more, even 50% and beyond — because it reduces
 * the interest paid to the bank; and the difference between three and five years, to see
 * how a small effort now saves millions later. The right balance is key.
 *
 * So every plan row carries the ladder and the tenor comparison for ITS vehicle, in RWF,
 * so the trainer reads the driver's own numbers back to them (curriculum rule 12: the
 * driver's own numbers are the textbook). Two things are deliberately NOT said here:
 * "you should" — the balance between stake, daily cost and a cash buffer is the driver's
 * to strike — and any rate. Cost is shown as per working day and as total interest.
 */
export function whatIfFor(
  priceRwf: number,
  requiredRwf: number,
  tenor: 36 | 60,
): WhatIf {
  const base = quoteLoan(priceRwf - requiredRwf, tenor, UNGUKA_RATE_BANDS);

  const step = (label: string, contributionRwf: number): LadderStep => {
    const c = Math.min(Math.round(contributionRwf), priceRwf - 1);
    const q = quoteLoan(priceRwf - c, tenor, UNGUKA_RATE_BANDS);
    return {
      label,
      contributionRwf: c,
      contributionPctOfPrice: Math.round((c / priceRwf) * 1000) / 10,
      facilityRwf: priceRwf - c,
      dailyRwf: q.dailyRwf,
      totalInterestRwf: q.totalInterestRwf,
      interestSavedRwf: base.totalInterestRwf - q.totalInterestRwf,
      dailySavedRwf: base.dailyRwf - q.dailyRwf,
    };
  };

  const ladder = [
    step(
      `Band minimum (${Math.round((requiredRwf / priceRwf) * 100)}%)`,
      requiredRwf,
    ),
    step('20% of price', priceRwf * 0.2),
    step('30% of price', priceRwf * 0.3),
    step('50% of price', priceRwf * 0.5),
  ];

  const plus100k = quoteLoan(
    priceRwf - requiredRwf - 100_000,
    tenor,
    UNGUKA_RATE_BANDS,
  );
  const interestSavedPer100k =
    base.totalInterestRwf - plus100k.totalInterestRwf;

  const three = quoteLoan(priceRwf - requiredRwf, 36, UNGUKA_RATE_BANDS);
  const five = quoteLoan(priceRwf - requiredRwf, 60, UNGUKA_RATE_BANDS);
  const extraPerDay = three.dailyRwf - five.dailyRwf;
  const totalSaved = five.totalInterestRwf - three.totalInterestRwf;

  return {
    interestSavedPer100kRwf: interestSavedPer100k,
    contributionLadder: ladder,
    tenor: {
      threeYears: {
        dailyRwf: three.dailyRwf,
        totalInterestRwf: three.totalInterestRwf,
      },
      fiveYears: {
        dailyRwf: five.dailyRwf,
        totalInterestRwf: five.totalInterestRwf,
      },
      extraPerDayFor3yRwf: extraPerDay,
      totalSavedBy3yRwf: totalSaved,
      sentence:
        `Three years costs RWF ${extraPerDay.toLocaleString('en-RW')} more per working day than five ` +
        `and saves RWF ${totalSaved.toLocaleString('en-RW')} in total interest — and the car is yours two years sooner. ` +
        `Five years leaves more in hand each day for the bad week. The right balance is the driver's to choose.`,
    },
  };
}

export function planSupport(inputs: readonly SupportRowInput[]): SupportPlan {
  if (!inputs.length) throw new BadRequestException('No rows to plan.');
  const rows = inputs.map(planRow);
  const sum = (f: (r: SupportRowPlan) => number) =>
    rows.reduce((t, r) => t + f(r), 0);
  return {
    rows,
    totals: {
      clients: rows.length,
      eligibleForSupport: rows.filter(
        (r) => !r.belowDriverMinimum && r.uzaSupportRwf > 0,
      ).length,
      belowDriverMinimum: rows.filter((r) => r.belowDriverMinimum).length,
      vehiclesRwf: sum((r) => r.vehiclePriceRwf),
      requiredContributionRwf: sum((r) => r.requiredContributionRwf),
      driverContributionRwf: sum((r) => r.driverHasRwf),
      uzaSupportRwf: sum((r) => r.uzaSupportRwf),
      facilityRwf: sum((r) => r.facilityRwf),
    },
    assumptions: [
      `Contribution band: ${LOWER_BAND_PCT}% at or below RWF ${BAND_THRESHOLD_RWF.toLocaleString('en-RW')}, ${UPPER_BAND_PCT}% above (Unguka, confirmed 19 Aug 2026).`,
      'Driver minimum stake, by vehicle price: under 20M → 1M; 20–25M → 1.5M; 25–30M → 2M; over 30M → 2.5M (programme rule, 20 Sept 2026). Cohort 1 rows may carry a grandfathered 500k.',
      'Instalments quoted on the Unguka bands (34% p.a. to 36 months, 36% p.a. to 60), reducing balance, 30-day months, rounded up daily. Displayed as cost per day, never as a rate, per Unguka.',
      'Insurance not included. Comprehensive at 5.5% of value per year is a lender requirement and can be cash or financed; see the pitch portal for both modes.',
      'This sizes what UZA would place if the bank approves. It is not a credit decision.',
    ],
  };
}

// ── Spreadsheet in ─────────────────────────────────────────────────────────────────────

/**
 * Column names accepted, case- and punctuation-insensitive. Written for a sheet a finance
 * officer would actually make, not one designed for a parser: "Vehicle price", "Has (RWF)",
 * "% of 10%", "Tenor" all work.
 */
const COLUMN_ALIASES: Record<keyof SupportRowInput, string[]> = {
  reference: [
    'reference',
    'ref',
    'uzaid',
    'uza id',
    'client',
    'name',
    'applicant',
    'id',
  ],
  vehicle: ['vehicle', 'car', 'model', 'vehicle choice', 'choice'],
  vehiclePriceRwf: [
    'vehiclepricerwf',
    'price',
    'vehicle price',
    'price rwf',
    'vehicle price rwf',
    'cost',
  ],
  driverHasRwf: [
    'driverhasrwf',
    'has',
    'has rwf',
    'saved',
    'savings',
    'contribution',
    'driver has',
    'amount saved',
    'deposit',
  ],
  driverHasPctOfRequired: [
    'driverhaspctofrequired',
    'pct',
    '%',
    'percent',
    '% of required',
    '% of 10%',
    'pct of required',
    'share',
    'has %',
  ],
  tenorMonths: ['tenormonths', 'tenor', 'months', 'term', 'tenor months'],
  grandfatheredMinimumRwf: [
    'grandfathered minimum',
    'accepted minimum',
    'minimum accepted (rwf)',
    'cohort minimum',
  ],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

export function mapHeader(header: string): keyof SupportRowInput | null {
  const h = norm(header);
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [
    keyof SupportRowInput,
    string[],
  ][]) {
    if (aliases.some((a) => norm(a) === h)) return key;
  }
  return null;
}

/** Cells arrive as unknown; only primitives are meaningful as text. */
const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
    return String(v);
  if (v instanceof Date) return v.toISOString();
  return '';
};

const toNumber = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  const cleaned = text(v)
    .replace(/rwf/i, '')
    .replace(/[,\s%]/g, '')
    .trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Rows of arbitrary keyed cells → typed inputs. Unknown columns are ignored; rows with no
 * price are skipped and reported. A percentage given as 0.4 is read as 40%.
 */
export function rowsFromCells(records: readonly Record<string, unknown>[]): {
  inputs: SupportRowInput[];
  skipped: { row: number; reason: string }[];
} {
  const inputs: SupportRowInput[] = [];
  const skipped: { row: number; reason: string }[] = [];

  records.forEach((rec, i) => {
    const mapped: Partial<Record<keyof SupportRowInput, unknown>> = {};
    for (const [k, v] of Object.entries(rec)) {
      const key = mapHeader(k);
      if (key && mapped[key] === undefined) mapped[key] = v;
    }
    const price = toNumber(mapped.vehiclePriceRwf);
    if (price === undefined) {
      skipped.push({ row: i + 2, reason: 'no vehicle price' });
      return;
    }
    let pct = toNumber(mapped.driverHasPctOfRequired);
    if (pct !== undefined && pct <= 1) pct = pct * 100;
    const tenorRaw = toNumber(mapped.tenorMonths);
    const tenor = tenorRaw === 36 || tenorRaw === 60 ? tenorRaw : undefined;
    if (tenorRaw !== undefined && !tenor) {
      skipped.push({ row: i + 2, reason: `tenor ${tenorRaw} is not 36 or 60` });
      return;
    }
    inputs.push({
      reference: text(mapped.reference) || `row ${i + 2}`,
      vehicle: text(mapped.vehicle) || undefined,
      vehiclePriceRwf: price,
      driverHasRwf: toNumber(mapped.driverHasRwf),
      driverHasPctOfRequired: pct,
      tenorMonths: tenor,
      grandfatheredMinimumRwf: toNumber(mapped.grandfatheredMinimumRwf),
    });
  });
  return { inputs, skipped };
}

/** A minimal CSV reader — quoted fields, commas, CRLF. No dependency for the common case. */
export function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(
      headers.map((h, i) => [h, (cells[i] ?? '').trim()]),
    );
  });
}

/** The plan back out as CSV, for the finance officer who sent a spreadsheet in. */
export function planToCsv(plan: SupportPlan): string {
  const head = [
    'reference',
    'vehicle',
    'vehicle_price_rwf',
    'band_pct',
    'required_contribution_rwf',
    'suggested_client_minimum_rwf',
    'driver_has_rwf',
    'driver_has_pct',
    'uza_support_rwf',
    'facility_rwf',
    'tenor_months',
    'monthly_rwf',
    'daily_rwf',
    'below_driver_minimum',
    'driver_still_needs_rwf',
    'interest_saved_per_100k_rwf',
    'daily_3y_rwf',
    'daily_5y_rwf',
    'total_saved_by_3y_rwf',
    'notes',
  ];
  const esc = (v: unknown) => {
    const s = text(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = plan.rows.map((r) =>
    [
      r.reference,
      r.vehicle ?? '',
      r.vehiclePriceRwf,
      r.bandPct,
      r.requiredContributionRwf,
      r.suggestedDriverMinimumRwf,
      r.driverHasRwf,
      r.driverHasPctOfRequired,
      r.uzaSupportRwf,
      r.facilityRwf,
      r.tenorMonths,
      r.monthlyRwf,
      r.dailyRwf,
      r.belowDriverMinimum ? 'yes' : 'no',
      r.driverStillNeedsRwf,
      r.whatIf.interestSavedPer100kRwf,
      r.whatIf.tenor.threeYears.dailyRwf,
      r.whatIf.tenor.fiveYears.dailyRwf,
      r.whatIf.tenor.totalSavedBy3yRwf,
      r.notes.join(' | '),
    ]
      .map(esc)
      .join(','),
  );
  const t = plan.totals;
  lines.push('');
  lines.push(
    [
      'TOTAL',
      '',
      t.vehiclesRwf,
      '',
      t.requiredContributionRwf,
      t.driverContributionRwf,
      '',
      t.uzaSupportRwf,
      t.facilityRwf,
      '',
      '',
      '',
      `${t.belowDriverMinimum} below minimum`,
      '',
      `${t.clients} clients, ${t.eligibleForSupport} eligible for support`,
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
