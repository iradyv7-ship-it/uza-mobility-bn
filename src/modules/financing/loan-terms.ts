import { BadRequestException } from '@nestjs/common';

/**
 * What a driver actually pays, and the rate that produces it.
 *
 * Two rules from the founder shape this file, and they pull in opposite directions:
 *
 *  1. **A borrower is never shown a percentage.** They are told what they pay per day
 *     over three years or five. A taxi driver budgets in days, not in annual nominal
 *     rates, and "34% p.a." is a number that sounds survivable until you total it.
 *
 *  2. **The rate must therefore be exactly right**, because it is invisible. Nobody
 *     sanity-checks a daily figure the way they would sanity-check a percentage. If the
 *     rate is wrong, the error reaches a signature.
 *
 * The rate is not one number. Unguka charges **34% a year to three years and 36% for
 * four and five** (founder, 31 August 2026 — not published by Unguka; confirm in writing
 * before this goes into an agreement). A calculator holding a single flat rate quotes
 * four- and five-year loans too cheaply, which is the failure mode that shows up as a
 * dispute at signing rather than as a bug.
 */

/** One band of a lender's schedule: this rate applies up to and including this tenor. */
export interface RateBand {
  readonly maxTenorMonths: number;
  readonly annualRateBps: number;
}

/**
 * Unguka / LOLC Unguka Finance.
 *
 * Source: Yves Iradukunda, direct, 31 August 2026. **Not published by Unguka.** The
 * evidence base records this as founder-stated, and the contribution percentage,
 * insurance requirement and security terms are still unknown — a rate alone does not
 * size a deal. Confirm the legal counterparty name in writing before signing anything.
 */
export const UNGUKA_RATE_BANDS: readonly RateBand[] = [
  { maxTenorMonths: 36, annualRateBps: 3400 }, // 0–3 years: 34% p.a.
  { maxTenorMonths: 60, annualRateBps: 3600 }, // 4–5 years: 36% p.a.
];

/**
 * The rate for a requested tenor: the narrowest band that still covers it.
 *
 * Refuses a tenor no band covers rather than falling back to the highest rate. Quoting a
 * driver a rate the lender never agreed to is worse than declining to quote — the first
 * is a number somebody signs, the second is a conversation.
 */
export function resolveAnnualRateBps(
  bands: readonly RateBand[],
  tenorMonths: number,
): number {
  if (!Number.isInteger(tenorMonths) || tenorMonths <= 0) {
    throw new BadRequestException(
      'tenorMonths must be a positive whole number of months',
    );
  }
  if (bands.length === 0) {
    throw new BadRequestException('this product has no agreed interest bands');
  }

  const covering = [...bands]
    .filter((b) => tenorMonths <= b.maxTenorMonths)
    .sort((a, b) => a.maxTenorMonths - b.maxTenorMonths)[0];

  if (!covering) {
    const longest = Math.max(...bands.map((b) => b.maxTenorMonths));
    throw new BadRequestException(
      `no agreed rate covers a ${tenorMonths}-month tenor; the longest agreed term is ${longest} months`,
    );
  }
  return covering.annualRateBps;
}

export interface LoanQuote {
  /** Principal the lender advances, in whole RWF. */
  readonly financedRwf: number;
  readonly tenorMonths: number;
  readonly monthlyRwf: number;
  /**
   * What the driver is actually shown. Days, not months — it is how a taxi earns.
   */
  readonly dailyRwf: number;
  readonly totalRepayableRwf: number;
  readonly totalInterestRwf: number;
  /**
   * Present so operations and the lender can reconcile. **Never render this to a
   * borrower** — see the rule at the top of this file.
   */
  readonly annualRateBps: number;
}

/**
 * WORKING days per month used to turn a monthly instalment into the daily figure.
 *
 * 26, not 30. Until 12 September 2026 this was 30 calendar days, reasoned as "a driver
 * sets this aside every morning". The pitch portal Unguka has already seen, the curriculum
 * (module 2.1: "instalment ÷ working days"), and the wallet's streak all count WORKING
 * days — the days the driver actually earns on. The two systems quoted the same monthly
 * figure and daily figures 15% apart, and the one the bank had been shown was 26.
 *
 * Working days is also the honest unit for the driver: a target set on calendar days is
 * one they silently miss every Sunday. Still rounded UP — being short at month end is the
 * borrower's problem, not the spreadsheet's — and 26 × the daily figure over-collects
 * against the monthly by construction, which is the safe direction to be wrong in.
 *
 * Reference, Neta U Pro 2022 at RWF 23.5M with 10% contribution: 60 months → RWF 29,393
 * per working day; 36 months → RWF 36,339. Both match the portal to the franc.
 */
export const WORKING_DAYS_PER_MONTH = 26;
const DAYS_PER_MONTH = WORKING_DAYS_PER_MONTH;

/**
 * A standard amortising instalment.
 *
 * `i` is the monthly rate; the annual figure is nominal and divided by twelve, which is
 * how Rwandan vehicle-loan schedules are quoted. If Unguka's schedule turns out to be
 * declining-balance on a different convention, this is the one function to change — and
 * `resolveAnnualRateBps` above will still hand it the right band.
 */
export function quoteLoan(
  financedRwf: number,
  tenorMonths: number,
  bands: readonly RateBand[],
): LoanQuote {
  if (!Number.isFinite(financedRwf) || financedRwf <= 0) {
    throw new BadRequestException('financedRwf must be a positive amount');
  }

  const annualRateBps = resolveAnnualRateBps(bands, tenorMonths);
  const monthlyRate = annualRateBps / 10_000 / 12;

  // A zero-rate product is legitimate (BK GO EV private terms are 0% deposit, and an
  // interest-free bridge is possible), and the amortisation formula divides by zero.
  const monthlyRaw =
    monthlyRate === 0
      ? financedRwf / tenorMonths
      : (financedRwf * monthlyRate) /
        (1 - Math.pow(1 + monthlyRate, -tenorMonths));

  // Whole francs. There is no minor unit in circulation, and a displayed decimal invites
  // somebody to type one.
  const monthlyRwf = Math.round(monthlyRaw);
  const totalRepayableRwf = monthlyRwf * tenorMonths;

  return {
    financedRwf: Math.round(financedRwf),
    tenorMonths,
    monthlyRwf,
    dailyRwf: Math.ceil(monthlyRwf / DAYS_PER_MONTH),
    totalRepayableRwf,
    totalInterestRwf: totalRepayableRwf - Math.round(financedRwf),
    annualRateBps,
  };
}

/** One row of a period-by-period repayment schedule. Whole francs throughout. */
export interface AmortizationRow {
  readonly period: number;
  readonly openingBalanceRwf: number;
  readonly paymentRwf: number;
  readonly interestRwf: number;
  readonly principalRwf: number;
  readonly closingBalanceRwf: number;
}

/**
 * The month-by-month breakdown `quoteLoan` deliberately doesn't produce — a single
 * instalment figure is what a borrower is shown, but a bank reviewing a file (or UZA
 * reconciling one) needs to see interest vs. principal move period by period.
 *
 * The final row absorbs whatever whole-franc rounding accumulated across the schedule, so
 * the loan always closes at exactly zero rather than a few francs short or over — the same
 * "round the loan, not the arithmetic" reasoning `quoteLoan` already applies once; this
 * applies it every period.
 */
export function generateAmortizationSchedule(
  financedRwf: number,
  tenorMonths: number,
  bands: readonly RateBand[],
): AmortizationRow[] {
  const quote = quoteLoan(financedRwf, tenorMonths, bands);
  const monthlyRate = quote.annualRateBps / 10_000 / 12;

  const rows: AmortizationRow[] = [];
  let balance = quote.financedRwf;

  for (let period = 1; period <= tenorMonths; period += 1) {
    const isLastPeriod = period === tenorMonths;
    const interestRwf = Math.round(balance * monthlyRate);
    const principalRwf = isLastPeriod
      ? balance
      : quote.monthlyRwf - interestRwf;
    const paymentRwf = isLastPeriod
      ? principalRwf + interestRwf
      : quote.monthlyRwf;
    const closingBalanceRwf = Math.max(0, balance - principalRwf);

    rows.push({
      period,
      openingBalanceRwf: balance,
      paymentRwf,
      interestRwf,
      principalRwf,
      closingBalanceRwf,
    });

    balance = closingBalanceRwf;
  }

  return rows;
}

/**
 * What changing a loan's tenor actually means: a fresh quote on the SAME outstanding
 * principal at the NEW tenor's rate band, never a discount applied to the old figures.
 * Stretching 36 months to 60 does not extend the old 34% quote — it is a new loan-terms
 * calculation at 36%, on whatever principal is still owed today. This is the one function
 * both `LoanTenorService.changeTenor` (real loans) and any "what if" preview call.
 */
export function recalculateForNewTenor(
  outstandingRwf: number,
  newTenorMonths: number,
  bands: readonly RateBand[],
): LoanQuote {
  return quoteLoan(outstandingRwf, newTenorMonths, bands);
}
