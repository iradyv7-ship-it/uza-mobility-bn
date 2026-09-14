import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  evaluateCovenants,
  worstOf,
  type CovenantInput,
} from './covenant.rules';
import type { DailyRecord } from './wallet.rules';

/**
 * Properties of the covenant engine that must hold for every history the generator can
 * produce. These are the promises in the header of covenant.rules.ts, stated so that a
 * reviewer does not have to trust the examples: nothing reaches a lender at NOTICE; nothing
 * reaches a lender on a loan that is not live; every warning names its day so it cannot fire
 * twice; and the engine is a pure function of its input.
 */

const NOW = new Date('2026-12-10T08:00:00Z');
const DAY = 86_400_000;
const RUNS = { numRuns: 400 };

const dayArb = (target: number): fc.Arbitrary<Omit<DailyRecord, 'date'>> =>
  fc
    .tuple(
      fc.oneof(
        { weight: 3, arbitrary: fc.constant(0) },
        { weight: 5, arbitrary: fc.integer({ min: 1, max: target * 2 }) },
      ),
      fc.oneof(
        { weight: 7, arbitrary: fc.constant(0) },
        { weight: 2, arbitrary: fc.integer({ min: 1, max: target * 2 }) },
      ),
    )
    .map(([depositedRwf, pendingRwf]) => ({
      depositedRwf,
      pendingRwf,
      targetRwf: target,
      hit: target > 0 ? depositedRwf >= target : depositedRwf > 0,
    }));

const dailyArb = (target: number): fc.Arbitrary<DailyRecord[]> =>
  fc.array(dayArb(target), { minLength: 90, maxLength: 90 }).map((rows) =>
    rows.map((r, i) => ({
      ...r,
      date: new Date(NOW.getTime() - (89 - i) * DAY).toISOString().slice(0, 10),
    })),
  );

const statusArb = fc.constantFrom(
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'DECLINED',
  'DISBURSED',
  'ACTIVE',
  'IN_ARREARS',
  'CLOSED',
);

const dateBeforeNow = (maxDaysAgo: number) =>
  fc
    .integer({ min: 0, max: maxDaysAgo })
    .map((d) => new Date(NOW.getTime() - d * DAY));

const inputArb: fc.Arbitrary<CovenantInput> = fc
  .integer({ min: 1_000, max: 60_000 })
  .chain((target) =>
    fc.record({
      now: fc.constant(NOW),
      daily: dailyArb(target),
      dailyTargetRwf: fc.constantFrom(target, null),
      loan: fc.oneof(
        fc.constant(null),
        fc.record({
          id: fc.constant('l1'),
          reference: fc.constant('L-1'),
          disbursedAt: fc.oneof(fc.constant(null), dateBeforeNow(200)),
          status: statusArb,
        }),
      ),
      inspection: fc.record({
        lastAt: fc.oneof(fc.constant(null), dateBeforeNow(120)),
        nextDueAt: fc.oneof(
          fc.constant(null),
          fc
            .integer({ min: -60, max: 60 })
            .map((d) => new Date(NOW.getTime() + d * DAY)),
        ),
        lastPassed: fc.constantFrom(null, true, false),
        openSafetyFindings: fc.integer({ min: 0, max: 5 }),
      }),
      comprehension: fc.oneof(
        fc.constant(null),
        fc.record({
          previousPct: fc.oneof(
            fc.constant(null),
            fc.integer({ min: 0, max: 100 }),
          ),
          latestPct: fc.oneof(
            fc.constant(null),
            fc.integer({ min: 0, max: 100 }),
          ),
        }),
      ),
    }),
  );

const LIVE = ['ACTIVE', 'IN_ARREARS', 'DISBURSED'];

describe('covenant engine — properties', () => {
  it('nothing reaches a lender at NOTICE', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        for (const c of evaluateCovenants(input)) {
          if (c.severity === 'NOTICE')
            expect(c.audience).not.toContain('LENDER');
        }
      }),
      RUNS,
    );
  });

  it('unless the loan is live, nothing reaches the driver or a lender — only UZA-internal coaching may fire', () => {
    // Training precedes disbursement, so a falling re-test is a UZA coaching signal whatever
    // the loan's state. Everything else — deposits, inspections — presupposes a live loan.
    fc.assert(
      fc.property(inputArb, (input) => {
        const live = input.loan && LIVE.includes(input.loan.status);
        if (live) return;
        for (const c of evaluateCovenants(input)) {
          expect(c.kind).toBe('COMPREHENSION_FALLING');
          expect(c.audience).toEqual(['UZA']);
        }
      }),
      RUNS,
    );
  });

  it('every covenant is addressed to somebody, and a lender is never the only one told', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        for (const c of evaluateCovenants(input)) {
          expect(c.audience.length).toBeGreaterThan(0);
          if (c.audience.includes('LENDER')) {
            expect(c.audience).toContain('UZA');
            expect(c.audience).toContain('DRIVER');
          }
        }
      }),
      RUNS,
    );
  });

  it('a stale reconciliation is never the lender’s business', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        for (const c of evaluateCovenants(input)) {
          if (c.kind === 'DEPOSIT_UNRECONCILED')
            expect(c.audience).toEqual(['DRIVER', 'UZA']);
        }
      }),
      RUNS,
    );
  });

  it('each kind fires at most once per run, and its dedupe key names today', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const cs = evaluateCovenants(input);
        const kinds = cs.map((c) => c.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
        for (const c of cs) expect(c.dedupeKey).toContain('2026-12-10');
      }),
      RUNS,
    );
  });

  it('today is never counted as a miss — clearing today’s row changes nothing about deposits', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const withoutToday: CovenantInput = {
          ...input,
          daily: input.daily.map((r, i) =>
            i === input.daily.length - 1
              ? { ...r, depositedRwf: 0, pendingRwf: 0, hit: false }
              : r,
          ),
        };
        const pick = (cs: ReturnType<typeof evaluateCovenants>) =>
          cs
            .filter((c) => c.kind.startsWith('DEPOSIT_'))
            .map((c) => ({
              kind: c.kind,
              severity: c.severity,
              detail: c.detail,
            }));
        expect(pick(evaluateCovenants(withoutToday))).toEqual(
          pick(evaluateCovenants(input)),
        );
      }),
      RUNS,
    );
  });

  it('confirming a held deposit can only make things better, never worse', () => {
    const rank = (s: string | null) =>
      s === null ? 0 : s === 'NOTICE' ? 1 : s === 'WARNING' ? 2 : 3;
    fc.assert(
      fc.property(
        inputArb,
        fc.integer({ min: 1, max: 14 }),
        (input, daysAgo) => {
          const idx = input.daily.length - 1 - daysAgo;
          const row = input.daily[idx];
          fc.pre(row.depositedRwf === 0 && row.pendingRwf > 0);
          const confirmed: CovenantInput = {
            ...input,
            daily: input.daily.map((r, i) =>
              i === idx
                ? {
                    ...r,
                    depositedRwf: r.pendingRwf,
                    pendingRwf: 0,
                    hit: r.targetRwf > 0 ? r.pendingRwf >= r.targetRwf : true,
                  }
                : r,
            ),
          };
          const missedBefore = evaluateCovenants(input).find(
            (c) => c.kind === 'DEPOSIT_MISSED',
          );
          const missedAfter = evaluateCovenants(confirmed).find(
            (c) => c.kind === 'DEPOSIT_MISSED',
          );
          expect(rank(missedAfter?.severity ?? null)).toBeLessThanOrEqual(
            rank(missedBefore?.severity ?? null),
          );
        },
      ),
      RUNS,
    );
  });

  it('is deterministic — the same input always gives the same answer', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(evaluateCovenants(input)).toEqual(evaluateCovenants(input));
      }),
      RUNS,
    );
  });

  it('the badge is null exactly when there is nothing open, and never below any covenant present', () => {
    const rank = (s: string | null) =>
      s === null ? 0 : s === 'NOTICE' ? 1 : s === 'WARNING' ? 2 : 3;
    fc.assert(
      fc.property(inputArb, (input) => {
        const cs = evaluateCovenants(input);
        const w = worstOf(cs);
        expect(w === null).toBe(cs.length === 0);
        for (const c of cs)
          expect(rank(w)).toBeGreaterThanOrEqual(rank(c.severity));
      }),
      RUNS,
    );
  });
});
