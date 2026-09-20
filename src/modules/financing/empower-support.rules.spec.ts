import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  contributionBandPct,
  contributionBandPctBefore20Sept2026,
  mapHeader,
  parseCsv,
  planRow,
  planSupport,
  planToCsv,
  requiredContributionRwf,
  rowsFromCells,
} from './empower-support.rules';

/**
 * The fund's arithmetic. Every reference figure below is one Unguka has already seen in the
 * pitch portal; if this file and the portal disagree, one of them is misquoting the bank.
 */

describe('the contribution band', () => {
  it('is 10% at every price since 20 Sept 2026 — the bank agreed 10% for the BYD Yuan Ups too', () => {
    expect(contributionBandPct(23_500_000)).toBe(10);
    expect(contributionBandPct(25_000_000)).toBe(10);
    expect(contributionBandPct(25_000_001)).toBe(10);
    expect(contributionBandPct(31_500_000)).toBe(10);
  });

  it('keeps the pre-20-September position legible, unapplied', () => {
    expect(contributionBandPctBefore20Sept2026(25_000_000)).toBe(10);
    expect(contributionBandPctBefore20Sept2026(25_000_001)).toBe(15);
  });

  it('reproduces the reference figures to the franc', () => {
    expect(requiredContributionRwf(23_500_000)).toBe(2_350_000); // Neta U Pro 2022
    expect(requiredContributionRwf(31_500_000)).toBe(3_150_000); // BYD Yuan Up 2025, at 10%
  });
});

describe('one client', () => {
  it('computes UZA support as the gap above what the driver has', () => {
    // A cohort-1 row, accepted at 500k: the minimum is grandfathered on the row.
    const r = planRow({
      reference: 'A',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 500_000,
      grandfatheredMinimumRwf: 500_000,
    });
    expect(r.requiredContributionRwf).toBe(2_350_000);
    expect(r.suggestedDriverMinimumRwf).toBe(1_500_000);
    expect(r.uzaSupportRwf).toBe(1_850_000);
    expect(r.facilityRwf).toBe(21_150_000);
    expect(r.belowDriverMinimum).toBe(false);
  });

  it('accepts the driver position as a percentage of the required contribution', () => {
    // "They have 40% of the 10%."
    const r = planRow({
      reference: 'B',
      vehiclePriceRwf: 23_500_000,
      driverHasPctOfRequired: 40,
    });
    expect(r.driverHasRwf).toBe(940_000);
    // 940k is below the 1.5M minimum for a 20–25M vehicle: support is sized from the minimum.
    expect(r.belowDriverMinimum).toBe(true);
    expect(r.uzaSupportRwf).toBe(2_350_000 - 1_500_000);
    expect(r.driverHasPctOfRequired).toBe(40);
  });

  it('does not let UZA replace the driver stake below the minimum', () => {
    // A 23.5M vehicle sits in the 20–25M band: the client's own minimum is 1.5M.
    const r = planRow({
      reference: 'C',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 200_000,
    });
    expect(r.suggestedDriverMinimumRwf).toBe(1_500_000);
    expect(r.belowDriverMinimum).toBe(true);
    expect(r.driverStillNeedsRwf).toBe(1_300_000);
    // Support is sized from the minimum, not from what they currently hold.
    expect(r.uzaSupportRwf).toBe(2_350_000 - 1_500_000);
    expect(r.notes.join(' ')).toMatch(/below the RWF 1,500,000 minimum/);
  });

  it('suggests the client minimum by price band, and a grandfathered row keeps its own', () => {
    expect(
      planRow({
        reference: 'a',
        vehiclePriceRwf: 18_500_000,
        driverHasRwf: 1_000_000,
      }).suggestedDriverMinimumRwf,
    ).toBe(1_000_000);
    expect(
      planRow({
        reference: 'b',
        vehiclePriceRwf: 22_000_000,
        driverHasRwf: 1_500_000,
      }).suggestedDriverMinimumRwf,
    ).toBe(1_500_000);
    expect(
      planRow({
        reference: 'c',
        vehiclePriceRwf: 29_800_000,
        driverHasRwf: 2_000_000,
      }).suggestedDriverMinimumRwf,
    ).toBe(2_000_000);
    expect(
      planRow({
        reference: 'd',
        vehiclePriceRwf: 31_500_000,
        driverHasRwf: 2_500_000,
      }).suggestedDriverMinimumRwf,
    ).toBe(2_500_000);
    // Cohort 1 E70 accepted at 500k: the suggestion still says 1M, the applied minimum is 500k,
    // and UZA's support closes the whole gap above 500k.
    const e70 = planRow({
      reference: 'e',
      vehiclePriceRwf: 18_500_000,
      driverHasRwf: 500_000,
      grandfatheredMinimumRwf: 500_000,
    });
    expect(e70.suggestedDriverMinimumRwf).toBe(1_000_000);
    expect(e70.appliedDriverMinimumRwf).toBe(500_000);
    expect(e70.belowDriverMinimum).toBe(false);
    expect(e70.uzaSupportRwf).toBe(1_850_000 - 500_000);
  });

  it('quotes the same daily figure the portal shows for the Neta U Pro at 5 years', () => {
    const r = planRow({
      reference: 'D',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 2_350_000,
      tenorMonths: 60,
    });
    expect(r.uzaSupportRwf).toBe(0);
    expect(r.dailyRwf).toBe(29_393);
    expect(r.notes.join(' ')).toMatch(/no UZA support needed/);
  });

  it('and at 3 years', () => {
    const r = planRow({
      reference: 'E',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 2_350_000,
      tenorMonths: 36,
    });
    expect(r.dailyRwf).toBe(36_339);
  });

  it('warns when amount and percentage disagree, and uses the amount', () => {
    const r = planRow({
      reference: 'F',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 1_000_000,
      driverHasPctOfRequired: 10,
    });
    expect(r.driverHasRwf).toBe(1_000_000);
    expect(r.notes.join(' ')).toMatch(/disagree/);
  });

  it('refuses a row with neither amount nor percentage, naming the row', () => {
    expect(() =>
      planRow({ reference: 'Mukamana', vehiclePriceRwf: 20_000_000 }),
    ).toThrow(/Mukamana: give either/);
    expect(() =>
      planRow({ reference: 'X', vehiclePriceRwf: 0, driverHasRwf: 1 }),
    ).toThrow(BadRequestException);
  });
});

describe('a cohort', () => {
  it('totals the facility UZA has to size', () => {
    // Cohort-2 rules: 20–25M needs 1.5M of the driver's own; over 30M needs 2.5M.
    const plan = planSupport([
      { reference: 'A', vehiclePriceRwf: 23_500_000, driverHasRwf: 1_500_000 },
      {
        reference: 'B',
        vehiclePriceRwf: 23_500_000,
        driverHasPctOfRequired: 40, // 940k — below the 1.5M minimum
      },
      { reference: 'C', vehiclePriceRwf: 31_500_000, driverHasRwf: 2_500_000 },
      { reference: 'D', vehiclePriceRwf: 23_500_000, driverHasRwf: 200_000 },
    ]);
    expect(plan.totals.clients).toBe(4);
    expect(plan.totals.belowDriverMinimum).toBe(2);
    expect(plan.totals.eligibleForSupport).toBe(2);
    // Support is sized from the applicable minimum for the two below it.
    expect(plan.totals.uzaSupportRwf).toBe(
      850_000 + 850_000 + (3_150_000 - 2_500_000) + 850_000,
    );
    expect(plan.assumptions.some((a) => /not a credit decision/.test(a))).toBe(
      true,
    );
  });
});

describe('the spreadsheet', () => {
  it('maps the column names a finance officer actually writes', () => {
    expect(mapHeader('Vehicle price (RWF)')).toBe('vehiclePriceRwf');
    expect(mapHeader('% of 10%')).toBe('driverHasPctOfRequired');
    expect(mapHeader('Has RWF')).toBe('driverHasRwf');
    expect(mapHeader('UZA ID')).toBe('reference');
    expect(mapHeader('Tenor')).toBe('tenorMonths');
    expect(mapHeader('Comments')).toBeNull();
  });

  it('parses a CSV with quoted names and thousands separators', () => {
    const csv = [
      'UZA ID,Vehicle,Vehicle price (RWF),Has RWF,% of 10%,Tenor,Comments',
      '"UZA-P-2026-000141","Neta U Pro 2022","23,500,000","500,000",,60,referred by Unguka',
      'UZA-P-2026-000142,BYD Yuan Up 2025,31500000,,40%,36,',
      'UZA-P-2026-000143,Neta U Pro 2023,,500000,,60,no price yet',
    ].join('\r\n');
    const { inputs, skipped } = rowsFromCells(parseCsv(csv));
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      reference: 'UZA-P-2026-000141',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 500_000,
      tenorMonths: 60,
    });
    expect(inputs[1]).toMatchObject({
      vehiclePriceRwf: 31_500_000,
      driverHasPctOfRequired: 40,
      tenorMonths: 36,
    });
    expect(skipped).toEqual([{ row: 4, reason: 'no vehicle price' }]);
  });

  it('reads 0.4 as 40%', () => {
    const { inputs } = rowsFromCells([{ ref: 'A', price: 23500000, pct: 0.4 }]);
    expect(inputs[0].driverHasPctOfRequired).toBe(40);
  });

  it('writes the plan back as CSV with a total line', () => {
    const csv = planToCsv(
      planSupport([
        {
          reference: 'A',
          vehiclePriceRwf: 23_500_000,
          driverHasRwf: 1_500_000,
        },
      ]),
    );
    expect(csv.split('\n')[0]).toMatch(
      /^reference,vehicle,vehicle_price_rwf,band_pct,required_contribution_rwf,suggested_client_minimum_rwf/,
    );
    expect(csv).toMatch(/\nTOTAL,/);
    expect(csv).toMatch(/,2350000,1500000,1500000,/);
    expect(csv).toMatch(/850000/);
  });
});

describe('what a bigger stake or a shorter term saves — the lesson in numbers', () => {
  const r = planRow({
    reference: 'Neta',
    vehiclePriceRwf: 23_500_000,
    driverHasRwf: 2_350_000,
    tenorMonths: 60,
  });

  it('shows the ladder from the band minimum up to 50% of price', () => {
    const labels = r.whatIf.contributionLadder.map((l) => l.label);
    expect(labels[0]).toMatch(/Band minimum \(10%\)/);
    expect(labels.at(-1)).toBe('50% of price');
    const fifty = r.whatIf.contributionLadder.at(-1)!;
    expect(fifty.contributionRwf).toBe(11_750_000);
    expect(fifty.facilityRwf).toBe(11_750_000);
    // 50% of price is 11.75M against a baseline facility of 21.15M — 56% of it, not half,
    // because the baseline already had 10% down. RWF 16,330 per working day vs 29,393.
    expect(fifty.dailyRwf).toBe(16_330);
    expect(fifty.interestSavedRwf).toBeGreaterThan(10_000_000);
  });

  it('prices each extra RWF 100,000 of stake in interest saved', () => {
    // At 36% p.a. over five years, RWF 100,000 less borrowed saves well over its own value in interest.
    expect(r.whatIf.interestSavedPer100kRwf).toBeGreaterThan(100_000);
    expect(r.whatIf.interestSavedPer100kRwf).toBeLessThan(200_000);
  });

  it('puts three years against five in the driver’s own units', () => {
    const t = r.whatIf.tenor;
    expect(t.threeYears.dailyRwf).toBe(36_339);
    expect(t.fiveYears.dailyRwf).toBe(29_393);
    expect(t.extraPerDayFor3yRwf).toBe(6_946);
    expect(t.totalSavedBy3yRwf).toBe(
      t.fiveYears.totalInterestRwf - t.threeYears.totalInterestRwf,
    );
    expect(t.totalSavedBy3yRwf).toBeGreaterThan(10_000_000);
    expect(t.sentence).toMatch(/6,946 more per working day/);
    expect(t.sentence).toMatch(/the driver's to choose/);
    // Never a rate.
    expect(t.sentence).not.toMatch(/3[46]\s*%/);
  });

  it('is the same ladder whatever the driver currently holds — it describes the vehicle, not the person', () => {
    const poorer = planRow({
      reference: 'P',
      vehiclePriceRwf: 23_500_000,
      driverHasRwf: 500_000,
      tenorMonths: 60,
    });
    expect(poorer.whatIf).toEqual(r.whatIf);
  });
});
