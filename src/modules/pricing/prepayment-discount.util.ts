import { BadRequestException } from '@nestjs/common';

/**
 * Prepayment discount: the client pays for a vehicle still in China, and the earlier and
 * larger the payment, the larger the discount.
 *
 *   100% paid -> 5.0% off        75% paid -> 3.0% off        50% paid -> 1.5% off
 *
 * WHY A TABLE AND NOT A FORMULA
 *
 * This used to be `discount = prepayment ÷ 10`, linear, on the argument that a table
 * invites a client at 74% to ask why they get the same as one at 51%.
 *
 * The ladder set on 1 September 2026 is deliberately NOT linear, so the formula could not
 * survive. Read the marginal rate on each additional slice of prepayment:
 *
 *   0  -> 50%   : 1.5% earned on 50% more paid   = 3% on the extra slice
 *   50 -> 75%   : 1.5% earned on 25% more paid   = 6% on the extra slice
 *   75 -> 100%  : 2.0% earned on 25% more paid   = 8% on the extra slice
 *
 * The reward accelerates with commitment. That is the point: half-measures earn least per
 * franc, and going all the way earns most. A linear rule cannot express that, and the
 * client at 74% now has a real answer — pay one more percent and the rate on everything
 * above 75 nearly doubles.
 *
 * WHAT THIS COSTS UZA, because a discount does not look like borrowing and is
 *
 * Paying 100% up front against delivery roughly four months later earns 5%. That is UZA
 * borrowing the vehicle's price for a third of a year at 5%, or about **15% a year** —
 * which is cheaper than commercial working capital in Rwanda and materially cheaper than
 * the previous ladder's ~30%. It also removes cancellation risk, credit risk and the
 * financing cost of the order.
 *
 * `annualisedCostPercent()` keeps that trade-off visible in the same place as the
 * discount, rather than discovered later in a margin review.
 */

/** Below this, no discount is earned. Set here so the policy has exactly one home. */
export const MIN_PREPAYMENT_PERCENT = 50;

/**
 * The ladder, highest threshold first.
 *
 * Read as "at least this much prepaid earns this much off". A client paying 60% earns the
 * 50% tier — tiers are floors, not exact matches, because a client who pays MORE must
 * never earn LESS, and interpolating between tiers would be clever, unpredictable and
 * impossible to quote over a phone.
 */
export const PREPAYMENT_LADDER: readonly {
  minPrepaymentPercent: number;
  discountPercent: number;
}[] = [
  { minPrepaymentPercent: 100, discountPercent: 5 },
  { minPrepaymentPercent: 75, discountPercent: 3 },
  { minPrepaymentPercent: 50, discountPercent: 1.5 },
];

/** The most UZA will ever give, whatever a future rule change does. A hard stop. */
export const MAX_DISCOUNT_PERCENT = 5;

export interface PrepaymentQuote {
  prepaymentPercent: number;
  discountPercent: number;
  /** Discount in the same minor units as the price passed in. */
  discountAmount: number;
  /** What the client pays in total, after the discount. */
  netPriceAfterDiscount: number;
  /** What must clear before the discount is honoured. See the note on cleared funds. */
  amountDueNow: number;
}

/**
 * The discount earned by prepaying `prepaymentPercent` of the price.
 *
 * Returns 0 below the floor rather than throwing: a client asking about 20% is asking a
 * legitimate question and should be told "no discount", not shown an error.
 */
export function discountPercentFor(prepaymentPercent: number): number {
  assertPercent(prepaymentPercent, 'prepaymentPercent');

  // Highest threshold the client clears. The ladder is ordered highest-first, so the
  // first match is the best one they qualify for.
  const tier = PREPAYMENT_LADDER.find(
    (t) => prepaymentPercent >= t.minPrepaymentPercent,
  );
  if (!tier) return 0;

  return Math.min(tier.discountPercent, MAX_DISCOUNT_PERCENT);
}

/**
 * Price a prepayment offer.
 *
 * `priceMinor` is in MINOR units (cents) and every amount returned is too. Money is never
 * a float here: 0.1 + 0.2 is not 0.3, and a rounding error on a vehicle is not a rounding
 * error a client will accept.
 *
 * Rounding favours the CLIENT on the discount (round half up) and the discount is applied
 * to the whole price before the prepayment share is taken — so a client paying 50% pays
 * half of the *discounted* price, not half of the list price. Doing it the other way round
 * quietly gives a smaller benefit than the headline promises, and somebody eventually
 * notices.
 */
export function quotePrepayment(
  priceMinor: number,
  prepaymentPercent: number,
): PrepaymentQuote {
  if (!Number.isInteger(priceMinor) || priceMinor < 0) {
    throw new BadRequestException(
      'priceMinor must be a non-negative integer of minor units',
    );
  }
  const discountPercent = discountPercentFor(prepaymentPercent);

  const discountAmount = Math.round((priceMinor * discountPercent) / 100);
  const netPriceAfterDiscount = priceMinor - discountAmount;
  const amountDueNow = Math.round(
    (netPriceAfterDiscount * prepaymentPercent) / 100,
  );

  return {
    prepaymentPercent,
    discountPercent,
    discountAmount,
    netPriceAfterDiscount,
    amountDueNow,
  };
}

/**
 * What the discount costs UZA as an annual rate, given how long the money is held.
 *
 * Not decoration. A 5% discount for a vehicle delivered in four months is ~15% a year, and
 * that belongs next to the discount whenever anyone is deciding whether to widen the ladder.
 */
export function annualisedCostPercent(
  discountPercent: number,
  daysUntilDelivery: number,
): number {
  if (daysUntilDelivery <= 0) {
    throw new BadRequestException('daysUntilDelivery must be positive');
  }
  return (discountPercent * 365) / daysUntilDelivery;
}

function assertPercent(v: number, name: string): void {
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    throw new BadRequestException(`${name} must be between 0 and 100`);
  }
}
