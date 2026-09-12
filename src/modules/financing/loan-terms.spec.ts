import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  quoteLoan,
  resolveAnnualRateBps,
  UNGUKA_RATE_BANDS,
  type RateBand,
} from './loan-terms';

/**
 * The rate a driver never sees, and therefore the one nobody sanity-checks.
 *
 * A borrower is shown a daily figure, not a percentage. That is the right call for the
 * audience and it removes the one number a person would have argued with — so the rate
 * behind it has to be exactly right, and these tests are the only thing checking it.
 *
 * The bug they exist to prevent: a calculator holding ONE flat rate. Unguka charges 34%
 * to three years and 36% for four and five, so a flat 34% under-quotes every long loan.
 * That surfaces as a dispute at signing, not as a crash.
 */

describe('the right band for the tenor', () => {
  it('charges 34% at one, two and three years', () => {
    for (const months of [12, 24, 36]) {
      expect(resolveAnnualRateBps(UNGUKA_RATE_BANDS, months)).toBe(3400);
    }
  });

  it('charges 36% at four and five years', () => {
    for (const months of [48, 60]) {
      expect(resolveAnnualRateBps(UNGUKA_RATE_BANDS, months)).toBe(3600);
    }
  });

  it('steps up at 37 months, not at 48', () => {
    // The boundary is where a flat-rate calculator is wrong and looks right. 36 months
    // is the last month of the cheaper band; 37 is the first of the dearer one.
    expect(resolveAnnualRateBps(UNGUKA_RATE_BANDS, 36)).toBe(3400);
    expect(resolveAnnualRateBps(UNGUKA_RATE_BANDS, 37)).toBe(3600);
  });

  it('refuses a tenor no band covers, rather than using the highest rate', () => {
    // Falling back would quote a rate the lender never agreed to, and somebody signs it.
    expect(() => resolveAnnualRateBps(UNGUKA_RATE_BANDS, 72)).toThrow(
      /no agreed rate covers a 72-month tenor/,
    );
  });

  it('refuses a product with no agreed bands', () => {
    expect(() => resolveAnnualRateBps([], 36)).toThrow(BadRequestException);
  });

  it('refuses a nonsense tenor', () => {
    expect(() => resolveAnnualRateBps(UNGUKA_RATE_BANDS, 0)).toThrow(
      BadRequestException,
    );
    expect(() => resolveAnnualRateBps(UNGUKA_RATE_BANDS, -12)).toThrow(
      BadRequestException,
    );
    expect(() => resolveAnnualRateBps(UNGUKA_RATE_BANDS, 36.5)).toThrow(
      BadRequestException,
    );
  });

  it('picks the narrowest covering band when several would cover', () => {
    const overlapping: RateBand[] = [
      { maxTenorMonths: 60, annualRateBps: 3600 },
      { maxTenorMonths: 36, annualRateBps: 3400 },
    ];
    expect(resolveAnnualRateBps(overlapping, 24)).toBe(3400);
  });
});

describe('what the driver is told', () => {
  // 16,000,000 vehicle, 10% deposit, so 14,400,000 financed — the figures on the
  // public calculator, which is where this was found to be using one flat rate.
  const FINANCED = 14_400_000;

  it('quotes a three-year loan at the 34% band', () => {
    const q = quoteLoan(FINANCED, 36, UNGUKA_RATE_BANDS);
    expect(q.annualRateBps).toBe(3400);
    expect(q.monthlyRwf).toBeGreaterThan(0);
    expect(q.totalRepayableRwf).toBe(q.monthlyRwf * 36);
    expect(q.totalInterestRwf).toBe(q.totalRepayableRwf - FINANCED);
  });

  it('quotes a five-year loan at 36%, not at 34%', () => {
    // The whole point. A flat-34% calculator makes this loan look cheaper than it is.
    const atCorrectRate = quoteLoan(FINANCED, 60, UNGUKA_RATE_BANDS);
    const atFlat34 = quoteLoan(FINANCED, 60, [
      { maxTenorMonths: 60, annualRateBps: 3400 },
    ]);

    expect(atCorrectRate.annualRateBps).toBe(3600);
    expect(atCorrectRate.monthlyRwf).toBeGreaterThan(atFlat34.monthlyRwf);
  });

  it('rounds the daily figure UP, never down', () => {
    // A driver sets this aside each morning. Rounding down leaves them short at the end
    // of the month, and being short is the borrower's problem, not the spreadsheet's.
    const q = quoteLoan(FINANCED, 36, UNGUKA_RATE_BANDS);
    expect(q.dailyRwf).toBe(Math.ceil(q.monthlyRwf / 26));
    expect(q.dailyRwf * 26).toBeGreaterThanOrEqual(q.monthlyRwf);
  });

  it('quotes per WORKING day, matching the figures the bank has already seen', () => {
    // Neta U Pro 2022, RWF 23.5M, 10% contribution → RWF 21.15M financed.
    expect(quoteLoan(21_150_000, 60, UNGUKA_RATE_BANDS).dailyRwf).toBe(29_393);
    expect(quoteLoan(21_150_000, 36, UNGUKA_RATE_BANDS).dailyRwf).toBe(36_339);
  });

  it('returns whole francs everywhere', () => {
    // There is no minor unit in circulation. A decimal on screen invites somebody to
    // type one into a payment field.
    const q = quoteLoan(FINANCED, 48, UNGUKA_RATE_BANDS);
    for (const v of [
      q.monthlyRwf,
      q.dailyRwf,
      q.totalRepayableRwf,
      q.totalInterestRwf,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('costs more over five years than over three, in total', () => {
    // Obvious, and worth pinning: a longer tenor lowers the daily figure, which is the
    // number the driver sees, while raising what they repay in the end.
    const three = quoteLoan(FINANCED, 36, UNGUKA_RATE_BANDS);
    const five = quoteLoan(FINANCED, 60, UNGUKA_RATE_BANDS);

    expect(five.dailyRwf).toBeLessThan(three.dailyRwf);
    expect(five.totalRepayableRwf).toBeGreaterThan(three.totalRepayableRwf);
  });

  it('handles a zero-rate product without dividing by zero', () => {
    // Legitimate: I&M and BK both advertise 0%-deposit EV terms, and an interest-free
    // bridge is possible. The amortisation formula divides by zero at rate 0.
    const q = quoteLoan(12_000_000, 24, [
      { maxTenorMonths: 24, annualRateBps: 0 },
    ]);
    expect(q.monthlyRwf).toBe(500_000);
    expect(q.totalInterestRwf).toBe(0);
  });

  it('refuses a non-positive principal', () => {
    expect(() => quoteLoan(0, 36, UNGUKA_RATE_BANDS)).toThrow(
      BadRequestException,
    );
    expect(() => quoteLoan(-1, 36, UNGUKA_RATE_BANDS)).toThrow(
      BadRequestException,
    );
  });
});
