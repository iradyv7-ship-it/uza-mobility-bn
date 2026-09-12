import { describe, expect, it } from 'vitest';
import {
  evaluateCovenants,
  isWorkingDay,
  worstOf,
  type CovenantInput,
} from './covenant.rules';
import type { DailyRecord } from './wallet.rules';

// Thursday 2026-12-10. Yesterday Wed 9, Tue 8, Mon 7, Sun 6 (rest), Sat 5, Fri 4.
const NOW = new Date('2026-12-10T08:00:00Z');
const DAY = 86_400_000;

/** Build 90 days of records ending today; `missing` = days-ago with no deposit. */
const daily = (
  missing: number[],
  target = 30_000,
  amountOn: Record<number, number> = {},
): DailyRecord[] =>
  Array.from({ length: 90 }, (_, i) => {
    const daysAgo = 89 - i;
    const d = new Date(NOW.getTime() - daysAgo * DAY);
    const dep = missing.includes(daysAgo) ? 0 : (amountOn[daysAgo] ?? target);
    return {
      date: d.toISOString().slice(0, 10),
      depositedRwf: dep,
      targetRwf: target,
      hit: dep >= target,
    };
  });

const base = (over: Partial<CovenantInput> = {}): CovenantInput => ({
  now: NOW,
  daily: daily([]),
  dailyTargetRwf: 30_000,
  loan: {
    id: 'l1',
    reference: 'L-1',
    disbursedAt: new Date('2026-10-01T00:00:00Z'),
    status: 'ACTIVE',
  },
  inspection: {
    lastAt: new Date('2026-11-20T00:00:00Z'),
    nextDueAt: new Date('2026-12-20T00:00:00Z'),
    lastPassed: true,
    openSafetyFindings: 0,
  },
  comprehension: null,
  ...over,
});

describe('working days', () => {
  it('rests on Sunday only', () => {
    expect(isWorkingDay(new Date('2026-12-06T00:00:00Z'))).toBe(false); // Sunday
    expect(isWorkingDay(new Date('2026-12-05T00:00:00Z'))).toBe(true); // Saturday
  });
});

describe('missed deposits', () => {
  it('is quiet when every working day has a deposit', () => {
    expect(
      evaluateCovenants(base()).filter((c) => c.kind === 'DEPOSIT_MISSED'),
    ).toEqual([]);
  });

  it('one miss is a NOTICE to the driver only', () => {
    const c = evaluateCovenants(base({ daily: daily([1]) })).find(
      (x) => x.kind === 'DEPOSIT_MISSED',
    )!;
    expect(c.severity).toBe('NOTICE');
    expect(c.audience).toEqual(['DRIVER']);
  });

  it('two in a row is a WARNING to driver and UZA, and names the button', () => {
    const c = evaluateCovenants(base({ daily: daily([1, 2]) })).find(
      (x) => x.kind === 'DEPOSIT_MISSED',
    )!;
    expect(c.severity).toBe('WARNING');
    expect(c.audience).toEqual(['DRIVER', 'UZA']);
    expect(c.message).toMatch(/I need help before I miss a payment/);
  });

  it('three in a row is an ALERT that reaches the lender', () => {
    const c = evaluateCovenants(base({ daily: daily([1, 2, 3]) })).find(
      (x) => x.kind === 'DEPOSIT_MISSED',
    )!;
    expect(c.severity).toBe('ALERT');
    expect(c.audience).toContain('LENDER');
    expect(c.detail.consecutiveMisses).toBe(3);
  });

  it('skips Sunday when counting a run — Sat, Sun, Mon missing is two misses, not three', () => {
    // 4 = Sat 5 Dec? NOW is Thu 10: 1=Wed, 2=Tue, 3=Mon, 4=Sun, 5=Sat. Miss Mon, Sun, Sat.
    const c = evaluateCovenants(base({ daily: daily([3, 4, 5]) })).find(
      (x) => x.kind === 'DEPOSIT_MISSED',
    );
    // Wed and Tue had deposits, so the run from yesterday is broken immediately: no covenant.
    expect(c).toBeUndefined();
    const c2 = evaluateCovenants(base({ daily: daily([1, 2, 3, 4, 5]) })).find(
      (x) => x.kind === 'DEPOSIT_MISSED',
    )!;
    expect(c2.detail.consecutiveMisses).toBe(4); // Wed, Tue, Mon, Sat — Sunday not counted
  });

  it('does not count today as a miss — the day is not over', () => {
    expect(
      evaluateCovenants(base({ daily: daily([0]) })).filter(
        (c) => c.kind === 'DEPOSIT_MISSED',
      ),
    ).toEqual([]);
  });

  it('says nothing about deposits when there is no active loan', () => {
    expect(
      evaluateCovenants(base({ daily: daily([1, 2, 3]), loan: null })).filter(
        (c) => c.kind === 'DEPOSIT_MISSED',
      ),
    ).toEqual([]);
  });
});

describe('short deposits', () => {
  it('warns driver and UZA, never the lender, when most of the week is below target', () => {
    const short = Object.fromEntries([1, 2, 3, 5, 7].map((d) => [d, 10_000]));
    const c = evaluateCovenants(base({ daily: daily([], 30_000, short) })).find(
      (x) => x.kind === 'DEPOSIT_SHORT',
    )!;
    expect(c.severity).toBe('WARNING');
    expect(c.audience).not.toContain('LENDER');
  });
});

describe('the monthly inspection', () => {
  it('is quiet before it is due', () => {
    expect(
      evaluateCovenants(base()).filter((c) => c.kind.startsWith('INSPECTION')),
    ).toEqual([]);
  });

  it('warns driver and UZA in the first week overdue, then alerts the lender', () => {
    const w = evaluateCovenants(
      base({
        inspection: {
          lastAt: new Date('2026-11-01T00:00:00Z'),
          nextDueAt: new Date('2026-12-05T00:00:00Z'),
          lastPassed: true,
          openSafetyFindings: 0,
        },
      }),
    ).find((x) => x.kind === 'INSPECTION_OVERDUE')!;
    expect(w.severity).toBe('WARNING');
    expect(w.audience).toEqual(['DRIVER', 'UZA']);
    const a = evaluateCovenants(
      base({
        inspection: {
          lastAt: new Date('2026-10-25T00:00:00Z'),
          nextDueAt: new Date('2026-11-25T00:00:00Z'),
          lastPassed: true,
          openSafetyFindings: 0,
        },
      }),
    ).find((x) => x.kind === 'INSPECTION_OVERDUE')!;
    expect(a.severity).toBe('ALERT');
    expect(a.audience).toContain('LENDER');
  });

  it('alerts when no inspection exists 35 days after handover', () => {
    const c = evaluateCovenants(
      base({
        inspection: {
          lastAt: null,
          nextDueAt: null,
          lastPassed: null,
          openSafetyFindings: 0,
        },
      }),
    ).find((x) => x.kind === 'INSPECTION_MISSING')!;
    expect(c.severity).toBe('ALERT');
    expect(c.detail.daysSinceDisbursement).toBe(70);
  });

  it('a failed inspection with an open safety defect is an ALERT the day it is filed', () => {
    const c = evaluateCovenants(
      base({
        inspection: {
          lastAt: NOW,
          nextDueAt: new Date(NOW.getTime() + 30 * DAY),
          lastPassed: false,
          openSafetyFindings: 2,
        },
      }),
    ).find((x) => x.kind === 'INSPECTION_FAILED_SAFETY')!;
    expect(c.severity).toBe('ALERT');
    expect(c.message).toMatch(/must not carry passengers/);
  });
});

describe('comprehension', () => {
  it('a falling re-test goes to UZA for coaching, not to the lender', () => {
    const c = evaluateCovenants(
      base({ comprehension: { previousPct: 83, latestPct: 50 } }),
    ).find((x) => x.kind === 'COMPREHENSION_FALLING')!;
    expect(c.audience).toEqual(['UZA']);
  });
});

describe('the badge', () => {
  it('is the worst severity present', () => {
    const cs = evaluateCovenants(
      base({
        daily: daily([1, 2]),
        comprehension: { previousPct: 83, latestPct: 50 },
      }),
    );
    expect(worstOf(cs)).toBe('WARNING');
    expect(worstOf([])).toBeNull();
  });
});
