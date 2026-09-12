import { describe, expect, it } from 'vitest';
import {
  CURRICULUM_HOURS,
  MIN_LOANS_FOR_A_CLAIM,
  NOT_MEASURED,
  repaymentComparison,
  trainingValue,
  type BorrowerOutcome,
} from './impact.rules';

describe('the value of the training', () => {
  it('is hours times a rate the finance team supplies, never a constant', () => {
    const v = trainingValue(CURRICULUM_HOURS * 10, 10, {
      costPerParticipantHourRwf: 12_000,
      rwfPerEur: 1_500,
    });
    expect(v.curriculumHoursPerParticipant).toBeGreaterThan(30);
    expect(v.valuePerParticipantRwf).toBe(
      Math.round(CURRICULUM_HOURS * 12_000),
    );
    expect(v.valueDeliveredRwf).toBe(v.valuePerParticipantRwf * 10);
    expect(v.benchmark.perTraineeEur).toBe(274);
    expect(v.benchmark.perTraineeRwf).toBe(411_000);
    expect(v.benchmark.confidence).toBe('PARTIAL');
  });
});

describe('the repayment claim, measured', () => {
  const loan = (
    certified: boolean,
    arrears: number,
    status = 'ACTIVE',
  ): BorrowerOutcome => ({
    certified,
    status,
    arrearsRwf: arrears,
    outstandingRwf: 10_000_000,
  });

  it('says plainly when there are no loans', () => {
    expect(repaymentComparison([]).verdict).toMatch(/No disbursed loans/);
  });

  it('refuses to make a claim on a small sample and says what would unlock it', () => {
    const r = repaymentComparison([loan(true, 0), loan(false, 50_000)]);
    expect(r.sufficient).toBe(false);
    expect(r.verdict).toMatch(new RegExp(`At least ${MIN_LOANS_FOR_A_CLAIM}`));
    expect(r.verdict).toMatch(/before cohort 2/);
  });

  it('reports the difference descriptively, never causally, when the sample is enough', () => {
    const rows = [
      ...Array.from({ length: 25 }, (_, i) => loan(true, i < 2 ? 10_000 : 0)),
      ...Array.from({ length: 25 }, (_, i) => loan(false, i < 8 ? 10_000 : 0)),
    ];
    const r = repaymentComparison(rows);
    expect(r.sufficient).toBe(true);
    expect(r.groups[0]).toMatchObject({
      group: 'certified',
      loans: 25,
      inArrears: 2,
      arrearsRatePct: 8,
    });
    expect(r.groups[1]).toMatchObject({
      group: 'not_certified',
      loans: 25,
      inArrears: 8,
      arrearsRatePct: 32,
    });
    expect(r.verdict).toMatch(/24\.0 points lower/);
    expect(r.verdict).toMatch(/not causal/);
  });

  it('reports the unwelcome result as it is', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => loan(true, i < 6 ? 1 : 0)),
      ...Array.from({ length: 20 }, (_, i) => loan(false, i < 2 ? 1 : 0)),
    ];
    expect(repaymentComparison(rows).verdict).toMatch(/do NOT show lower/);
  });

  it('ignores loans that never disbursed', () => {
    const r = repaymentComparison([
      loan(true, 0, 'PENDING'),
      loan(false, 0, 'DECLINED'),
    ]);
    expect(r.groups[0].loans + r.groups[1].loans).toBe(0);
  });
});

describe('what is not measured', () => {
  it('names carbon explicitly, with the evidence-base reason', () => {
    const co2 = NOT_MEASURED.find((n) => /CO₂ avoided/.test(n.metric));
    expect(co2?.reason).toMatch(
      /motorcycle figures must not be presented as car figures/,
    );
    expect(co2?.unlockedBy).toMatch(/1\.4/);
  });
});
