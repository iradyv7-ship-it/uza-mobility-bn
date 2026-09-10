import { describe, expect, it } from 'vitest';
import { summarizeSavings } from './loan-savings.util';

describe('summarizeSavings', () => {
  it('returns zeroes for no recorded days', () => {
    const result = summarizeSavings([]);
    expect(result).toEqual({
      entries: [],
      cumulativeSurplusRwf: 0,
      daysRecorded: 0,
    });
  });

  it('accumulates a surplus when deposits consistently exceed what was required', () => {
    const result = summarizeSavings([
      { date: '2026-09-01', depositedRwf: 6000, requiredDailyRwf: 5000 },
      { date: '2026-09-02', depositedRwf: 6000, requiredDailyRwf: 5000 },
      { date: '2026-09-03', depositedRwf: 6000, requiredDailyRwf: 5000 },
    ]);

    expect(result.daysRecorded).toBe(3);
    expect(result.cumulativeSurplusRwf).toBe(3000);
    // Running, not just final — a lender reading the trend needs each day's position.
    expect(result.entries.map((e) => e.cumulativeSurplusRwf)).toEqual([
      1000, 2000, 3000,
    ]);
  });

  it('goes negative the moment a shortfall day lands, and can recover', () => {
    const result = summarizeSavings([
      { date: '2026-09-01', depositedRwf: 5000, requiredDailyRwf: 5000 }, // on track: 0
      { date: '2026-09-02', depositedRwf: 2000, requiredDailyRwf: 5000 }, // -3000
      { date: '2026-09-03', depositedRwf: 8000, requiredDailyRwf: 5000 }, // back to 0
    ]);

    expect(result.entries.map((e) => e.cumulativeSurplusRwf)).toEqual([
      0, -3000, 0,
    ]);
    expect(result.cumulativeSurplusRwf).toBe(0);
  });

  it('does not mutate or re-sort its input', () => {
    const input = [
      { date: '2026-09-02', depositedRwf: 5000, requiredDailyRwf: 5000 },
      { date: '2026-09-01', depositedRwf: 5000, requiredDailyRwf: 5000 },
    ];
    const frozen = structuredClone(input);
    summarizeSavings(input);
    expect(input).toEqual(frozen);
  });
});
