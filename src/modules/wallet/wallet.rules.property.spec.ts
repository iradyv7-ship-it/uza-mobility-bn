import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  assertAllocationAllowed,
  BUCKETS,
  bucketBalances,
  performance,
  splitDeposit,
  type Bucket,
  type LedgerLine,
  type Split,
} from './wallet.rules';

/**
 * Property-based tests for the money rules.
 *
 * The example tests in wallet.rules.spec.ts show that the rules do the right thing on the
 * cases somebody thought of. These show that certain things are true for every input the
 * generator can produce — which is the kind of statement a bank's reviewer, or Gad, will
 * actually ask for: "can a franc ever go missing in the split?", "can a pending line ever
 * change what the lender sees?". Each property is written as that question.
 *
 * Amounts are whole francs, as everywhere in the ledger. The upper bound is RWF 100M per
 * line — larger than any deposit a Twara EV driver will make, small enough that sums stay
 * exact in a JS number.
 */

const NOW = new Date('2026-12-10T18:00:00Z');
const DAY = 86_400_000;
const RUNS = { numRuns: 300 };

const bucketArb = fc.constantFrom<Bucket>(...BUCKETS);
const bucketOrNullArb = fc.oneof(
  { weight: 9, arbitrary: bucketArb },
  { weight: 1, arbitrary: fc.constant(null) },
);
const francsArb = fc.integer({ min: 1, max: 100_000_000 });

/** Five whole percentages that add up to 100, any distribution. */
const splitArb: fc.Arbitrary<Split> = fc
  .tuple(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  )
  .map(([a, b, c, d]) => [a, b, c, d].sort((x, y) => x - y))
  .map(([a, b, c, d]) => ({
    LOAN: a,
    MAINTENANCE: b - a,
    CHARGING: c - b,
    INSURANCE: d - c,
    PERSONAL: 100 - d,
  }));

const lineArb: fc.Arbitrary<LedgerLine> = fc.record({
  bucket: bucketOrNullArb,
  direction: fc.constantFrom<'CREDIT' | 'DEBIT'>('CREDIT', 'DEBIT'),
  amountRwf: francsArb,
  // Anywhere from 120 days before NOW to 5 days after — so lines fall inside, before and
  // after the 90-day window.
  occurredAt: fc
    .integer({ min: -120, max: 5 })
    .map((d) => new Date(NOW.getTime() + d * DAY + 6 * 3_600_000)),
  confirmedAt: fc.oneof(fc.constant(null), fc.constant(NOW)),
  recordedBy: fc.constantFrom<'DRIVER' | 'STAFF' | 'INSTITUTION'>(
    'DRIVER',
    'STAFF',
    'INSTITUTION',
  ),
  reason: fc.constant('MOMO_DEPOSIT'),
});
const linesArb = fc.array(lineArb, { maxLength: 60 });

const signed = (l: LedgerLine) =>
  l.direction === 'CREDIT' ? l.amountRwf : -l.amountRwf;

describe('splitDeposit — properties', () => {
  it('never loses or invents a franc: the parts always add up to the deposit', () => {
    fc.assert(
      fc.property(francsArb, splitArb, (amount, split) => {
        const parts = splitDeposit(amount, split);
        const total = BUCKETS.reduce((t, b) => t + parts[b], 0);
        expect(total).toBe(amount);
      }),
      RUNS,
    );
  });

  it('every part is a whole, non-negative number of francs', () => {
    fc.assert(
      fc.property(francsArb, splitArb, (amount, split) => {
        const parts = splitDeposit(amount, split);
        for (const b of BUCKETS) {
          expect(Number.isInteger(parts[b])).toBe(true);
          expect(parts[b]).toBeGreaterThanOrEqual(0);
        }
      }),
      RUNS,
    );
  });

  it('the rounding remainder goes to the loan and is never more than the number of other buckets', () => {
    fc.assert(
      fc.property(francsArb, splitArb, (amount, split) => {
        const parts = splitDeposit(amount, split);
        const loanFloor = Math.floor((amount * split.LOAN) / 100);
        expect(parts.LOAN).toBeGreaterThanOrEqual(loanFloor);
        // Four floors, each dropping strictly less than one franc.
        expect(parts.LOAN - loanFloor).toBeLessThan(BUCKETS.length);
        for (const b of BUCKETS) {
          if (b === 'LOAN') continue;
          expect(parts[b]).toBe(Math.floor((amount * split[b]) / 100));
        }
      }),
      RUNS,
    );
  });

  it('a bucket with 0% never receives anything, unless it is the loan taking the remainder', () => {
    fc.assert(
      fc.property(francsArb, splitArb, (amount, split) => {
        const parts = splitDeposit(amount, split);
        for (const b of BUCKETS) {
          if (b !== 'LOAN' && split[b] === 0) expect(parts[b]).toBe(0);
        }
      }),
      RUNS,
    );
  });

  it('refuses any split that does not add up to 100', () => {
    fc.assert(
      fc.property(
        francsArb,
        splitArb,
        fc.integer({ min: -100, max: 100 }).filter((d) => d !== 0),
        (amount, split, delta) => {
          const broken = { ...split, PERSONAL: split.PERSONAL + delta };
          expect(() => splitDeposit(amount, broken)).toThrow(/add up to 100/);
        },
      ),
      RUNS,
    );
  });

  it('refuses a deposit that is not a positive whole number of francs', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.double({ noInteger: true, noNaN: true }),
        ),
        splitArb,
        (amount, split) => {
          expect(() => splitDeposit(amount, split)).toThrow(
            /positive whole number/,
          );
        },
      ),
      RUNS,
    );
  });
});

describe('bucketBalances — properties', () => {
  it('confirmed + pending = total, in every bucket, always', () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        for (const b of bucketBalances(lines)) {
          expect(b.confirmedRwf + b.pendingRwf).toBe(b.totalRwf);
        }
      }),
      RUNS,
    );
  });

  it('the buckets together account for every labelled franc, and ignore unlabelled lines', () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const total = bucketBalances(lines).reduce((t, b) => t + b.totalRwf, 0);
        const expected = lines
          .filter((l) => l.bucket !== null)
          .reduce((t, l) => t + signed(l), 0);
        expect(total).toBe(expected);
      }),
      RUNS,
    );
  });

  it('does not care about the order lines arrive in', () => {
    fc.assert(
      fc.property(linesArb, fc.nat(), (lines, seed) => {
        const shuffled = [...lines].sort(
          (a, b) =>
            ((a.amountRwf * 31 + seed) % 7) - ((b.amountRwf * 31 + seed) % 7),
        );
        expect(bucketBalances(shuffled)).toEqual(bucketBalances(lines));
      }),
      RUNS,
    );
  });

  it('a new confirmed credit moves exactly one bucket by exactly that amount', () => {
    fc.assert(
      fc.property(linesArb, bucketArb, francsArb, (lines, bucket, amount) => {
        const before = bucketBalances(lines);
        const after = bucketBalances([
          ...lines,
          {
            bucket,
            direction: 'CREDIT',
            amountRwf: amount,
            occurredAt: NOW,
            confirmedAt: NOW,
            recordedBy: 'INSTITUTION',
            reason: 'MOMO_DEPOSIT',
          },
        ]);
        for (let i = 0; i < before.length; i++) {
          const delta = before[i].bucket === bucket ? amount : 0;
          expect(after[i].confirmedRwf - before[i].confirmedRwf).toBe(delta);
          expect(after[i].pendingRwf).toBe(before[i].pendingRwf);
        }
      }),
      RUNS,
    );
  });
});

describe('performance — properties', () => {
  const targetArb = fc.oneof(
    fc.constant(null),
    fc.integer({ min: 1, max: 200_000 }),
  );

  const inWindow = (l: LedgerLine) =>
    l.occurredAt >= new Date(NOW.getTime() - 89 * DAY) && l.occurredAt <= NOW;
  const countsForLoan = (l: LedgerLine) =>
    l.direction === 'CREDIT' && l.bucket !== null && l.bucket !== 'PERSONAL';

  it('every figure stays inside its bounds', () => {
    fc.assert(
      fc.property(linesArb, targetArb, (lines, target) => {
        const p = performance(lines, target, null, NOW);
        expect(p.daily).toHaveLength(p.windowDays);
        expect(p.daysHit).toBeLessThanOrEqual(p.daysWithAnyDeposit);
        expect(p.daysWithAnyDeposit).toBeLessThanOrEqual(p.windowDays);
        expect(p.consistencyRatio).toBeGreaterThanOrEqual(0);
        expect(p.consistencyRatio).toBeLessThanOrEqual(1);
        expect(p.currentStreak).toBeLessThanOrEqual(p.longestStreak);
        expect(p.longestStreak).toBeLessThanOrEqual(p.windowDays);
        expect(p.totalConfirmedRwf).toBeGreaterThanOrEqual(0);
        expect(p.totalPendingRwf).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });

  it('the days are consecutive, oldest first, and end today', () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const p = performance(lines, null, null, NOW);
        expect(p.daily.at(-1)!.date).toBe(NOW.toISOString().slice(0, 10));
        for (let i = 1; i < p.daily.length; i++) {
          const prev = new Date(p.daily[i - 1].date + 'T00:00:00Z').getTime();
          const cur = new Date(p.daily[i].date + 'T00:00:00Z').getTime();
          expect(cur - prev).toBe(DAY);
        }
      }),
      RUNS,
    );
  });

  it('the confirmed total is exactly the confirmed loan-facing credits inside the window — and the daily rows add up to it', () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const p = performance(lines, null, null, NOW);
        const expected = lines
          .filter((l) => countsForLoan(l) && inWindow(l) && l.confirmedAt)
          .reduce((t, l) => t + l.amountRwf, 0);
        expect(p.totalConfirmedRwf).toBe(expected);
        expect(p.daily.reduce((t, r) => t + r.depositedRwf, 0)).toBe(expected);
        const pendingExpected = lines
          .filter((l) => countsForLoan(l) && inWindow(l) && !l.confirmedAt)
          .reduce((t, l) => t + l.amountRwf, 0);
        expect(p.totalPendingRwf).toBe(pendingExpected);
        expect(p.daily.reduce((t, r) => t + r.pendingRwf, 0)).toBe(
          pendingExpected,
        );
      }),
      RUNS,
    );
  });

  it("the driver's own savings, debits and unlabelled lines never change the record a lender reads", () => {
    const noiseArb: fc.Arbitrary<LedgerLine[]> = fc.array(
      fc.oneof<fc.Arbitrary<LedgerLine>[]>(
        lineArb.map((l) => ({ ...l, bucket: 'PERSONAL' })),
        lineArb.map((l) => ({ ...l, bucket: null })),
        lineArb.map((l) => ({ ...l, direction: 'DEBIT' as const })),
      ),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(linesArb, noiseArb, targetArb, (lines, noise, target) => {
        const clean = performance(lines, target, 2_000_000, NOW);
        const noisy = performance([...lines, ...noise], target, 2_000_000, NOW);
        // progressPct counts debits (a sweep to the instalment lowers the balance), so it is
        // the one figure allowed to move; everything the lender reads as behaviour is not.
        const { progressPct: _a, ...cleanRest } = clean;
        const { progressPct: _b, ...noisyRest } = noisy;
        expect(noisyRest).toEqual(cleanRest);
      }),
      RUNS,
    );
  });

  it('confirming a pending deposit moves francs from pending to confirmed without changing the sum, never lowers days on target, and keeps the streak', () => {
    fc.assert(
      fc.property(linesArb, targetArb, (lines, target) => {
        const pendingIdx = lines.findIndex(
          (l) => countsForLoan(l) && inWindow(l) && !l.confirmedAt,
        );
        fc.pre(pendingIdx >= 0);
        const before = performance(lines, target, null, NOW);
        const confirmed = lines.map((l, i) =>
          i === pendingIdx ? { ...l, confirmedAt: NOW } : l,
        );
        const after = performance(confirmed, target, null, NOW);
        expect(after.totalConfirmedRwf + after.totalPendingRwf).toBe(
          before.totalConfirmedRwf + before.totalPendingRwf,
        );
        expect(after.daysHit).toBeGreaterThanOrEqual(before.daysHit);
        expect(after.daysWithAnyDeposit).toBeGreaterThanOrEqual(
          before.daysWithAnyDeposit,
        );
        expect(after.currentStreak).toBe(before.currentStreak);
        expect(after.longestStreak).toBe(before.longestStreak);
      }),
      RUNS,
    );
  });

  it('is unchanged by the order of the lines', () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const reversed = [...lines].reverse();
        expect(performance(reversed, 30_000, 2_000_000, NOW)).toEqual(
          performance(lines, 30_000, 2_000_000, NOW),
        );
      }),
      RUNS,
    );
  });
});

describe('assertAllocationAllowed — properties', () => {
  it('a driver can never move a franc out of the loan bucket, whatever the balances', () => {
    fc.assert(
      fc.property(
        linesArb,
        bucketArb.filter((b) => b !== 'LOAN'),
        francsArb,
        (lines, to, amount) => {
          expect(() =>
            assertAllocationAllowed(
              'LOAN',
              to,
              amount,
              bucketBalances(lines),
              'DRIVER',
            ),
          ).toThrow(/only be moved by UZA/);
        },
      ),
      RUNS,
    );
  });

  it('a move is allowed exactly when it is within the confirmed balance of the source', () => {
    fc.assert(
      fc.property(
        linesArb,
        bucketArb,
        bucketArb,
        francsArb,
        fc.constantFrom<'DRIVER' | 'STAFF'>('DRIVER', 'STAFF'),
        (lines, from, to, amount, actor) => {
          fc.pre(from !== to);
          fc.pre(!(from === 'LOAN' && actor === 'DRIVER'));
          const balances = bucketBalances(lines);
          const confirmed = balances.find(
            (b) => b.bucket === from,
          )!.confirmedRwf;
          const run = () =>
            assertAllocationAllowed(from, to, amount, balances, actor);
          if (amount <= confirmed) expect(run).not.toThrow();
          else expect(run).toThrow(/not confirmed yet cannot be moved/);
        },
      ),
      RUNS,
    );
  });

  it('pending money is never movable: with nothing confirmed, every move is refused', () => {
    const pendingOnly = fc.array(
      lineArb.map((l) => ({
        ...l,
        confirmedAt: null,
        direction: 'CREDIT' as const,
      })),
      { maxLength: 20 },
    );
    fc.assert(
      fc.property(
        pendingOnly,
        bucketArb,
        bucketArb,
        francsArb,
        (lines, from, to, amount) => {
          fc.pre(from !== to);
          expect(() =>
            assertAllocationAllowed(
              from,
              to,
              amount,
              bucketBalances(lines),
              'STAFF',
            ),
          ).toThrow();
        },
      ),
      RUNS,
    );
  });
});
