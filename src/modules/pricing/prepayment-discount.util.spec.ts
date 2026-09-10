import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  annualisedCostPercent,
  discountPercentFor,
  MAX_DISCOUNT_PERCENT,
  MIN_PREPAYMENT_PERCENT,
  quotePrepayment,
} from './prepayment-discount.util';

describe('the published ladder', () => {
  // The three rungs a client is told, set 1 September 2026. If one changes it must be
  // because somebody decided to change the OFFER — not because a rule moved underneath it.
  it.each([
    [100, 5],
    [75, 3],
    [50, 1.5],
  ])('%i%% prepaid earns %s%% off', (prepaid, expected) => {
    expect(discountPercentFor(prepaid)).toBe(expected);
  });

  it('earns nothing below the floor, and says so rather than erroring', () => {
    // Asking about 20% is a legitimate question. The answer is "no discount", not a 400.
    expect(discountPercentFor(49)).toBe(0);
    expect(discountPercentFor(20)).toBe(0);
    expect(discountPercentFor(0)).toBe(0);
  });

  it('turns on exactly at the floor', () => {
    expect(discountPercentFor(MIN_PREPAYMENT_PERCENT - 0.01)).toBe(0);
    expect(discountPercentFor(MIN_PREPAYMENT_PERCENT)).toBe(1.5);
  });

  it('treats each rung as a floor: paying more never earns less', () => {
    // A client at 60% gets the 50% rung. Tiers are "at least this much", so the function
    // must be monotonic — the one property a pricing ladder can never violate.
    let previous = 0;
    for (let p = 0; p <= 100; p += 0.5) {
      const d = discountPercentFor(p);
      expect(d).toBeGreaterThanOrEqual(previous);
      previous = d;
    }
  });

  it('holds the rung until the next one is reached', () => {
    expect(discountPercentFor(60)).toBe(1.5);
    expect(discountPercentFor(74.99)).toBe(1.5);
    expect(discountPercentFor(75)).toBe(3);
    expect(discountPercentFor(99.99)).toBe(3);
    expect(discountPercentFor(100)).toBe(5);
  });

  it('rewards each extra slice of commitment MORE than the last', () => {
    // The reason the ladder is not linear. Marginal rate on the additional prepayment:
    //   0 -> 50   : 1.5 / 50 = 3%
    //   50 -> 75  : 1.5 / 25 = 6%
    //   75 -> 100 : 2.0 / 25 = 8%
    // Half-measures earn least per franc; going all the way earns most.
    const marginal = (fromPct: number, toPct: number) =>
      ((discountPercentFor(toPct) - discountPercentFor(fromPct)) /
        (toPct - fromPct)) *
      100;

    expect(marginal(0, 50)).toBeCloseTo(3, 6);
    expect(marginal(50, 75)).toBeCloseTo(6, 6);
    expect(marginal(75, 100)).toBeCloseTo(8, 6);

    expect(marginal(50, 75)).toBeGreaterThan(marginal(0, 50));
    expect(marginal(75, 100)).toBeGreaterThan(marginal(50, 75));
  });

  it('never exceeds the cap, whatever a future rule does', () => {
    expect(discountPercentFor(100)).toBeLessThanOrEqual(MAX_DISCOUNT_PERCENT);
  });

  it('rejects an impossible percentage', () => {
    expect(() => discountPercentFor(101)).toThrow(BadRequestException);
    expect(() => discountPercentFor(-1)).toThrow(BadRequestException);
    expect(() => discountPercentFor(Number.NaN)).toThrow(BadRequestException);
  });
});

describe('quoting a prepayment', () => {
  const PRICE = 21_000_00; // RWF 21,000.00 in minor units

  it('discounts the whole price, then takes the prepayment share of the DISCOUNTED price', () => {
    // Order matters and it is worth pinning. A client paying 50% pays half of the
    // discounted price. Applying the share first and discounting after would quietly give
    // a smaller benefit than the headline promises.
    const q = quotePrepayment(PRICE, 50);
    expect(q.discountPercent).toBe(1.5);
    expect(q.discountAmount).toBe(31_500); // 1.5% of 2,100,000
    expect(q.netPriceAfterDiscount).toBe(2_068_500);
    expect(q.amountDueNow).toBe(1_034_250); // half of the discounted price
  });

  it('at 100% the amount due now is the whole discounted price', () => {
    const q = quotePrepayment(PRICE, 100);
    expect(q.discountPercent).toBe(5);
    expect(q.amountDueNow).toBe(q.netPriceAfterDiscount);
    expect(q.netPriceAfterDiscount).toBe(1_995_000); // 2,100,000 less 5%
  });

  it('below the floor there is no discount and the client simply pays their share', () => {
    const q = quotePrepayment(PRICE, 30);
    expect(q.discountPercent).toBe(0);
    expect(q.discountAmount).toBe(0);
    expect(q.netPriceAfterDiscount).toBe(PRICE);
    expect(q.amountDueNow).toBe(630_000);
  });

  it('returns whole minor units — never a fraction of a franc', () => {
    // 7.5% of an odd price is not a whole number. Money must not carry a fraction into a
    // ledger or an invoice.
    const q = quotePrepayment(1_999_999, 75);
    for (const v of [
      q.discountAmount,
      q.netPriceAfterDiscount,
      q.amountDueNow,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('never lets the discount exceed the price', () => {
    const q = quotePrepayment(100, 100);
    expect(q.discountAmount).toBeLessThanOrEqual(100);
    expect(q.netPriceAfterDiscount).toBeGreaterThanOrEqual(0);
  });

  it('handles a zero price without dividing by anything', () => {
    const q = quotePrepayment(0, 100);
    expect(q.discountAmount).toBe(0);
    expect(q.amountDueNow).toBe(0);
  });

  it('rejects a price that is not whole minor units', () => {
    // A float price is how a rounding error reaches an invoice.
    expect(() => quotePrepayment(1234.5, 50)).toThrow(BadRequestException);
    expect(() => quotePrepayment(-1, 50)).toThrow(BadRequestException);
  });
});

describe('what the discount costs UZA', () => {
  it('prices the top rung, 5% over four months, as roughly 15% a year', () => {
    // The number that decides whether this ladder is good business. A discount does not
    // look like borrowing, and it is. At 15% a year this is cheaper than commercial
    // working capital in Rwanda — the previous ladder, at 10% over the same window, was
    // ~30% and was not.
    expect(Math.round(annualisedCostPercent(5, 120))).toBe(15);
  });

  it('costs more the sooner the vehicle arrives', () => {
    // Same discount, less time holding the money — a worse deal for UZA, not a better one.
    expect(annualisedCostPercent(10, 60)).toBeGreaterThan(
      annualisedCostPercent(10, 120),
    );
  });

  it('refuses a nonsensical delivery window rather than returning Infinity', () => {
    expect(() => annualisedCostPercent(10, 0)).toThrow(BadRequestException);
  });
});
