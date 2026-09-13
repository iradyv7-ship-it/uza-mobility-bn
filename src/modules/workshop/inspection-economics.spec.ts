import { describe, expect, it } from 'vitest';
import {
  CONTRACTED_INSPECTION_RATE_RWF,
  garageNetworkRevenue,
  inspectionEconomicsFor,
  nextInspectionDue,
} from './inspection-economics';

/**
 * The founder's own proposed numbers (500 RWF for used cars, a third of that for new)
 * turn out to be exactly right, for a precise reason: 12 inspections a year for a used
 * car, 4 for a new one — 12 ÷ 4 = 3 — so the daily rate has to scale by that same ratio.
 * These tests pin that identity, not just the two example figures.
 */
describe('inspection economics', () => {
  it('lands on the exact contracted rate for a used car over one cycle', () => {
    const e = inspectionEconomicsFor('USED');
    expect(e.cycleDays).toBe(30);
    expect(e.dailyReserveRwf).toBe(500);
    expect(e.dailyReserveRwf * e.cycleDays).toBeGreaterThanOrEqual(
      CONTRACTED_INSPECTION_RATE_RWF,
    );
  });

  it('lands on the exact contracted rate for a new car over one cycle', () => {
    const e = inspectionEconomicsFor('NEW');
    expect(e.cycleDays).toBe(90);
    expect(e.dailyReserveRwf).toBe(167); // 15,000 / 90 = 166.67, rounded up
    expect(e.dailyReserveRwf * e.cycleDays).toBeGreaterThanOrEqual(
      CONTRACTED_INSPECTION_RATE_RWF,
    );
  });

  it("a new car's daily reserve is a third of a used car's, matching the 12:4 ratio", () => {
    const used = inspectionEconomicsFor('USED');
    const newCar = inspectionEconomicsFor('NEW');
    // Not exact due to rounding, but must be within a franc of the true ratio.
    expect(newCar.dailyReserveRwf).toBeCloseTo(used.dailyReserveRwf / 3, 0);
  });

  it('rounds the daily reserve UP, never down — the safe direction, same as loan-terms.ts', () => {
    const e = inspectionEconomicsFor('NEW', 10_000); // 10,000 / 90 = 111.11
    expect(e.dailyReserveRwf).toBe(112);
  });

  it('splits the contracted rate 85/15 without losing or inventing a franc', () => {
    const e = inspectionEconomicsFor('USED');
    expect(e.garageTakeHomeRwf + e.uzaPlatformFeeRwf).toBe(e.contractedRateRwf);
    expect(e.garageTakeHomeRwf).toBe(12_750);
    expect(e.uzaPlatformFeeRwf).toBe(2_250);
  });

  it('respects a different contracted rate if one is ever renegotiated', () => {
    const e = inspectionEconomicsFor('USED', 20_000);
    expect(e.dailyReserveRwf).toBe(667); // 20,000 / 30 = 666.67, rounded up
    expect(e.garageTakeHomeRwf + e.uzaPlatformFeeRwf).toBe(20_000);
  });

  it('sets the next inspection 30 days out for a used car, 90 for a new one', () => {
    const start = new Date('2026-09-13T00:00:00.000Z');
    const usedDue = nextInspectionDue(start, 'USED');
    const newDue = nextInspectionDue(start, 'NEW');
    expect(usedDue.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(newDue.toISOString()).toBe('2026-12-12T00:00:00.000Z');
  });

  it('rolls up garage-network revenue across many filed inspections without drift', () => {
    const revenue = garageNetworkRevenue(1000);
    expect(revenue.totalCollectedRwf).toBe(15_000_000);
    expect(revenue.garageTakeHomeRwf).toBe(12_750_000);
    expect(revenue.uzaPlatformFeeRwf).toBe(2_250_000);
    expect(revenue.garageTakeHomeRwf + revenue.uzaPlatformFeeRwf).toBe(
      revenue.totalCollectedRwf,
    );
  });
});
