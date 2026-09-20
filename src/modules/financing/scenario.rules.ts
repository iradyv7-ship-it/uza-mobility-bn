/**
 * The financing scenario engine — every formula in one place, as pure functions.
 *
 * Yves, 20 September 2026: "our system should have the formulas inside, to know the 10%
 * rule, our support, how to calculate what the bank funds, and each change should affect
 * other numbers to best study different scenarios."
 *
 * The rules, as booked with Unguka for batch 1 and confirmed in writing:
 *
 *   required        = price × contributionPct              (10% at every price)
 *   UZA collateral  = max(0, required − client)            UZA closes the gap to the 10%
 *   bank loan       = price − client − UZA collateral      the bank lends the rest (90%)
 *   seller receives = client + bank loan                   UZA's pledge sits at the bank
 *   client minimum  = banded by price (driverMinimumRwf)   programme rule, not the bank's
 *   schedule        = quoteLoan(bank loan, tenor, rate)    26 working days → daily figure
 *
 * Any one of client, UZA or bank can be typed over; the engine re-derives the others and
 * says which rule it applied or overrode, and every departure from the rule is a `check`
 * with a severity. `block` means the loan cannot be booked like this; `warn` means it can,
 * but a human should look; `info` is arithmetic worth knowing.
 *
 * Nothing here is a credit decision. The bank still says yes or no.
 */
import type { RateBand } from './loan-terms';
import { quoteLoan, type LoanQuote } from './loan-terms';
import { driverMinimumRwf } from './empower-support.rules';
import {
  findLenderTerms,
  LENDER_TERMS,
  type LenderTerms,
} from './lender-terms.registry';

export interface ScenarioInput {
  vehiclePriceRwf: number;
  clientContributionRwf: number;
  tenorMonths: number;
  /** Lender whose terms apply. Omitted: generic terms (10%, rate must be given). */
  lenderKey?: string;
  // ── Overrides. Each replaces the rule, and the result says so. ──────────────────────
  /** Contribution expected by the bank, % of price. Default: the lender's (10). */
  contributionPct?: number;
  /** Interest, annual nominal, basis points. Default: the lender's band for the tenor. */
  annualRateBps?: number;
  /** UZA's cash collateral. Default: max(0, required − client). */
  uzaCollateralRwf?: number;
  /** What the bank lends. Default: price − client − UZA. Setting it re-derives UZA. */
  bankLoanRwf?: number;
  /** A client minimum accepted for this row that differs from the band (cohort 1: 500k). */
  grandfatheredMinimumRwf?: number;
}

export type CheckSeverity = 'info' | 'warn' | 'block';
export interface ScenarioCheck {
  code: string;
  severity: CheckSeverity;
  message: string;
}

export interface Scenario {
  lender: {
    key: string;
    name: string;
    confidence: LenderTerms['evidence']['confidence'];
  } | null;
  inputs: {
    vehiclePriceRwf: number;
    clientContributionRwf: number;
    tenorMonths: number;
  };
  rule: {
    contributionPct: number;
    contributionPctSource: 'lender' | 'override' | 'default';
    requiredContributionRwf: number;
    suggestedClientMinimumRwf: number;
    appliedClientMinimumRwf: number;
    annualRateBps: number | null;
    rateSource: 'lender' | 'override' | 'missing';
    uzaSource: 'rule' | 'override' | 'derivedFromBank';
    bankSource: 'rule' | 'override';
  };
  split: {
    clientContributionRwf: number;
    uzaCollateralRwf: number;
    bankLoanRwf: number;
    /** client + UZA — what the bank sees as the contribution. */
    coverRwf: number;
    coverPctOfPrice: number;
    bankPctOfPrice: number;
    /** client + bank loan — the cash that reaches the seller at disbursement. */
    sellerReceivesRwf: number;
    clientShortfallToMinimumRwf: number;
  };
  /** Null when no rate is available. */
  schedule: LoanQuote | null;
  checks: ScenarioCheck[];
  /** True when nothing blocks booking the loan on these numbers. */
  bookable: boolean;
}

const round = (n: number) => Math.round(n);
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
const rwf = (n: number) => `RWF ${Math.round(n).toLocaleString('en-RW')}`;

function bandsFor(
  terms: LenderTerms | undefined,
  tenorMonths: number,
  override?: number,
): {
  bands: readonly RateBand[] | null;
  source: Scenario['rule']['rateSource'];
} {
  if (override !== undefined) {
    return {
      bands: [
        { maxTenorMonths: Math.max(tenorMonths, 1), annualRateBps: override },
      ],
      source: 'override',
    };
  }
  if (terms?.rateBands) return { bands: terms.rateBands, source: 'lender' };
  return { bands: null, source: 'missing' };
}

export function scenario(input: ScenarioInput): Scenario {
  const checks: ScenarioCheck[] = [];
  const price = round(input.vehiclePriceRwf);
  const client = round(input.clientContributionRwf);
  const tenor = input.tenorMonths;
  const terms = input.lenderKey ? findLenderTerms(input.lenderKey) : undefined;

  if (input.lenderKey && !terms) {
    checks.push({
      code: 'UNKNOWN_LENDER',
      severity: 'block',
      message: `No lender "${input.lenderKey}" is on file.`,
    });
  }
  if (!Number.isFinite(price) || price <= 0) {
    checks.push({
      code: 'PRICE',
      severity: 'block',
      message: 'The vehicle price must be a positive amount.',
    });
  }
  if (!Number.isFinite(client) || client < 0) {
    checks.push({
      code: 'CLIENT',
      severity: 'block',
      message: 'The client contribution cannot be negative.',
    });
  }
  if (!Number.isInteger(tenor) || tenor <= 0) {
    checks.push({
      code: 'TENOR',
      severity: 'block',
      message: 'The tenor must be a whole number of months.',
    });
  }

  // ── The contribution rule ────────────────────────────────────────────────────────────
  const contributionPct =
    input.contributionPct ?? terms?.contributionPct ?? 10;
  const contributionPctSource: Scenario['rule']['contributionPctSource'] =
    input.contributionPct !== undefined
      ? 'override'
      : terms
        ? 'lender'
        : 'default';
  const required = round((price * contributionPct) / 100);
  const suggestedMin = price > 0 ? driverMinimumRwf(price) : 0;
  const appliedMin = input.grandfatheredMinimumRwf ?? suggestedMin;

  // ── The split: who brings what ───────────────────────────────────────────────────────
  let uza: number;
  let bank: number;
  let uzaSource: Scenario['rule']['uzaSource'] = 'rule';
  let bankSource: Scenario['rule']['bankSource'] = 'rule';

  if (input.bankLoanRwf !== undefined) {
    bank = round(input.bankLoanRwf);
    bankSource = 'override';
    if (input.uzaCollateralRwf !== undefined) {
      uza = round(input.uzaCollateralRwf);
      uzaSource = 'override';
    } else {
      // The bank's figure is fixed; whatever the client and the bank do not cover is UZA's.
      uza = Math.max(0, price - client - bank);
      uzaSource = 'derivedFromBank';
    }
  } else if (input.uzaCollateralRwf !== undefined) {
    uza = round(input.uzaCollateralRwf);
    uzaSource = 'override';
    bank = price - client - uza;
  } else {
    uza = Math.max(0, required - client);
    bank = price - client - uza;
  }

  const cover = client + uza;
  const sellerReceives = client + bank;
  const shortfall = Math.max(0, appliedMin - client);

  // ── Checks ───────────────────────────────────────────────────────────────────────────
  if (bank <= 0 && price > 0) {
    checks.push({
      code: 'NOTHING_TO_FINANCE',
      severity: 'block',
      message:
        'Client and UZA already cover the whole price; there is no loan to book.',
    });
  }
  if (cover < required && price > 0) {
    checks.push({
      code: 'COVER_BELOW_REQUIRED',
      severity: 'block',
      message: `Client + UZA = ${rwf(cover)} (${pct(cover, price)}%) is below the ${contributionPct}% the bank expects (${rwf(required)}). Short by ${rwf(required - cover)}.`,
    });
  } else if (cover > required && uza > 0) {
    checks.push({
      code: 'UZA_ABOVE_GAP',
      severity: 'warn',
      message: `UZA is pledging ${rwf(uza)} but the gap to ${contributionPct}% is only ${rwf(Math.max(0, required - client))}. UZA covers gaps, not stakes.`,
    });
  } else if (client > required) {
    checks.push({
      code: 'CLIENT_ABOVE_REQUIRED',
      severity: 'info',
      message: `The client brings more than the ${contributionPct}%; the bank lends ${rwf(bank)} (${pct(bank, price)}% of the price).`,
    });
  }
  if (client + uza + bank !== price && price > 0) {
    const diff = price - client - uza - bank;
    checks.push({
      code: 'SPLIT_DOES_NOT_ADD_UP',
      severity: 'warn',
      message: `Client + UZA + bank = ${rwf(client + uza + bank)} against a price of ${rwf(price)} (${diff < 0 ? 'over' : 'under'} by ${rwf(Math.abs(diff))}).`,
    });
  }
  if (shortfall > 0) {
    checks.push({
      code: 'CLIENT_BELOW_MINIMUM',
      severity: 'warn',
      message: `The client's own ${rwf(client)} is below the ${rwf(appliedMin)} minimum for a ${rwf(price)} vehicle; short by ${rwf(shortfall)}. UZA does not top up the client's own stake.`,
    });
  }
  if (terms && !terms.uzaCollateralAvailable && uza > 0) {
    checks.push({
      code: 'NO_UZA_FACILITY_WITH_LENDER',
      severity: 'warn',
      message: `No UZA cash-collateral facility exists with ${terms.name}; the ${rwf(uza)} would have to come from the client.`,
    });
  }
  if (terms && !terms.tenorsMonths.includes(tenor)) {
    checks.push({
      code: 'TENOR_NOT_OFFERED',
      severity: 'warn',
      message: `${terms.name} offers ${terms.tenorsMonths.join(', ')} months, not ${tenor}.`,
    });
  }
  if (terms && terms.evidence.confidence !== 'VERIFIED') {
    checks.push({
      code: 'TERMS_UNVERIFIED',
      severity: 'info',
      message: `${terms.name} terms are ${terms.evidence.confidence}: ${terms.evidence.source}`,
    });
  }

  // ── The schedule ─────────────────────────────────────────────────────────────────────
  const { bands, source: rateSource } = bandsFor(
    terms,
    tenor,
    input.annualRateBps,
  );
  let schedule: LoanQuote | null = null;
  if (!bands) {
    checks.push({
      code: 'RATE_MISSING',
      severity: 'block',
      message: `No agreed interest rate is on file${terms ? ` for ${terms.name}` : ''}; enter a rate to study the schedule.`,
    });
  } else if (bank > 0 && Number.isInteger(tenor) && tenor > 0) {
    try {
      schedule = quoteLoan(bank, tenor, bands);
    } catch (e) {
      checks.push({
        code: 'RATE_NOT_COVERING',
        severity: 'block',
        message: (e as Error).message,
      });
    }
  }

  const bookable = !checks.some((c) => c.severity === 'block');
  return {
    lender: terms
      ? {
          key: terms.key,
          name: terms.name,
          confidence: terms.evidence.confidence,
        }
      : null,
    inputs: {
      vehiclePriceRwf: price,
      clientContributionRwf: client,
      tenorMonths: tenor,
    },
    rule: {
      contributionPct,
      contributionPctSource,
      requiredContributionRwf: required,
      suggestedClientMinimumRwf: suggestedMin,
      appliedClientMinimumRwf: appliedMin,
      annualRateBps: schedule?.annualRateBps ?? input.annualRateBps ?? null,
      rateSource,
      uzaSource,
      bankSource,
    },
    split: {
      clientContributionRwf: client,
      uzaCollateralRwf: uza,
      bankLoanRwf: bank,
      coverRwf: cover,
      coverPctOfPrice: pct(cover, price),
      bankPctOfPrice: pct(bank, price),
      sellerReceivesRwf: sellerReceives,
      clientShortfallToMinimumRwf: shortfall,
    },
    schedule,
    checks,
    bookable,
  };
}

// ── Studies: the same engine run across one dimension at a time ─────────────────────────

export interface StudyPoint {
  label: string;
  /** What was changed against the base input. */
  input: Partial<ScenarioInput>;
  scenario: Scenario;
  /** Against the base: positive means this point costs the driver more per day. */
  dailyDeltaRwf: number | null;
  totalInterestDeltaRwf: number | null;
}

function point(
  base: Scenario,
  full: ScenarioInput,
  label: string,
  patch: Partial<ScenarioInput>,
): StudyPoint {
  const s = scenario({ ...full, ...patch });
  return {
    label,
    input: patch,
    scenario: s,
    dailyDeltaRwf:
      s.schedule && base.schedule
        ? s.schedule.dailyRwf - base.schedule.dailyRwf
        : null,
    totalInterestDeltaRwf:
      s.schedule && base.schedule
        ? s.schedule.totalInterestRwf - base.schedule.totalInterestRwf
        : null,
  };
}

export interface Study {
  base: Scenario;
  /** Same car, same client money: each lender on file at each of its tenors. */
  byLender: StudyPoint[];
  /** Same lender: 12 to 60 months in steps of 12, plus the tenor asked for. */
  byTenor: StudyPoint[];
  /** Same lender and tenor: the rate moved ±2 and ±4 points. Empty when no rate is known. */
  byRate: StudyPoint[];
  /** The contribution ladder: what more of the client's own money does to the daily figure. */
  byClientContribution: StudyPoint[];
}

/** The overrides that pin the split; cleared when the study moves the client's own money. */
const SPLIT_FREE = { uzaCollateralRwf: undefined, bankLoanRwf: undefined };

export function study(input: ScenarioInput): Study {
  const base = scenario(input);
  const price = base.inputs.vehiclePriceRwf;

  const byLender: StudyPoint[] = [];
  for (const l of LENDER_TERMS) {
    for (const t of l.tenorsMonths) {
      byLender.push(
        point(base, input, `${l.name} · ${t} months`, {
          lenderKey: l.key,
          tenorMonths: t,
          // A lender with no rate on file borrows the typed rate, if any, and says so.
          annualRateBps: l.rateBands ? undefined : input.annualRateBps,
          ...SPLIT_FREE,
        }),
      );
    }
  }

  const tenors = Array.from(
    new Set([12, 24, 36, 48, 60, input.tenorMonths]),
  ).sort((a, b) => a - b);
  const byTenor = tenors.map((t) =>
    point(base, input, `${t} months`, { tenorMonths: t }),
  );

  const baseRate = base.rule.annualRateBps;
  const byRate =
    baseRate === null
      ? []
      : [-400, -200, 0, 200, 400].map((d) =>
          point(
            base,
            input,
            d === 0
              ? 'Agreed rate'
              : `${d > 0 ? '+' : '−'}${Math.abs(d) / 100} points`,
            { annualRateBps: baseRate + d },
          ),
        );

  const required = base.rule.requiredContributionRwf;
  const ladderValues = Array.from(
    new Set(
      [
        base.rule.appliedClientMinimumRwf,
        base.inputs.clientContributionRwf,
        Math.round(required / 2),
        required,
        Math.round(required * 1.5),
        Math.round(required * 2),
        Math.round(price * 0.3),
      ].filter((v) => v >= 0 && v < price),
    ),
  ).sort((a, b) => a - b);
  const byClientContribution = ladderValues.map((c) =>
    point(
      base,
      input,
      c === base.inputs.clientContributionRwf
        ? `Client brings ${rwf(c)} (today)`
        : `Client brings ${rwf(c)}`,
      { clientContributionRwf: c, ...SPLIT_FREE },
    ),
  );

  return { base, byLender, byTenor, byRate, byClientContribution };
}

/**
 * What a borrower may see. The founder's rule (loan-terms.ts): a driver is told what they
 * pay per day, never a percentage. Staff and lenders see the rate; the driver's copy has it
 * removed, and the rate study is relabelled as harder/easier terms.
 */
export function forBorrower(s: Study): Study {
  const strip = (x: Scenario): Scenario => ({
    ...x,
    rule: { ...x.rule, annualRateBps: null },
    schedule: x.schedule ? { ...x.schedule, annualRateBps: 0 } : null,
  });
  const stripPoint = (p: StudyPoint): StudyPoint => ({
    ...p,
    input: { ...p.input, annualRateBps: undefined },
    scenario: strip(p.scenario),
  });
  const rateLabels = [
    'Much easier terms',
    'Easier terms',
    'Terms as agreed',
    'Harder terms',
    'Much harder terms',
  ];
  return {
    base: strip(s.base),
    byLender: s.byLender.map(stripPoint),
    byTenor: s.byTenor.map(stripPoint),
    byRate: s.byRate.map((p, i) => ({
      ...stripPoint(p),
      label: rateLabels[i] ?? p.label,
    })),
    byClientContribution: s.byClientContribution.map(stripPoint),
  };
}
