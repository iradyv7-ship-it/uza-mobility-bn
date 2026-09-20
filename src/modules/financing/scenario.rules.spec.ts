import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { forBorrower, scenario, study } from './scenario.rules';

const codes = (s: ReturnType<typeof scenario>) => s.checks.map((c) => c.code);

describe('the batch-1 bookings, reproduced from the rule alone', () => {
  it('Gisele: NETA U at 22.5M, she pays 1.5M → UZA 750k, bank 20.25M, seller 21.75M', () => {
    const s = scenario({
      vehiclePriceRwf: 22_500_000,
      clientContributionRwf: 1_500_000,
      tenorMonths: 60,
      lenderKey: 'unguka',
    });
    expect(s.split).toMatchObject({
      uzaCollateralRwf: 750_000,
      bankLoanRwf: 20_250_000,
      coverRwf: 2_250_000,
      coverPctOfPrice: 10,
      bankPctOfPrice: 90,
      sellerReceivesRwf: 21_750_000,
    });
    expect(s.schedule?.dailyRwf).toBe(28_142);
    expect(s.bookable).toBe(true);
    expect(codes(s)).toEqual([]);
  });

  it('a 500k client on a 22M U PRO: UZA 1.7M, bank 19.8M; warned below the minimum unless grandfathered', () => {
    const base = {
      vehiclePriceRwf: 22_000_000,
      clientContributionRwf: 500_000,
      tenorMonths: 60,
      lenderKey: 'unguka',
    };
    const s = scenario(base);
    expect(s.split.uzaCollateralRwf).toBe(1_700_000);
    expect(s.split.bankLoanRwf).toBe(19_800_000);
    expect(s.rule.suggestedClientMinimumRwf).toBe(1_500_000);
    expect(codes(s)).toContain('CLIENT_BELOW_MINIMUM');
    expect(s.bookable).toBe(true); // a warning, not a block — cohort 1 was booked like this

    const g = scenario({ ...base, grandfatheredMinimumRwf: 500_000 });
    expect(codes(g)).not.toContain('CLIENT_BELOW_MINIMUM');
    expect(g.rule.appliedClientMinimumRwf).toBe(500_000);
  });

  it('the BYDs are at 10% too: 31.5M with 2M → UZA 1.15M, bank 28.35M; with 2.5M → UZA 650k', () => {
    const a = scenario({ vehiclePriceRwf: 31_500_000, clientContributionRwf: 2_000_000, tenorMonths: 60, lenderKey: 'unguka' });
    expect(a.split.uzaCollateralRwf).toBe(1_150_000);
    expect(a.split.bankLoanRwf).toBe(28_350_000);
    const b = scenario({ vehiclePriceRwf: 31_500_000, clientContributionRwf: 2_500_000, tenorMonths: 60, lenderKey: 'unguka' });
    expect(b.split.uzaCollateralRwf).toBe(650_000);
    expect(b.split.bankLoanRwf).toBe(28_350_000);
  });

  it('the whole batch: UZA pledges 17.35M and the bank lends 372.15M', () => {
    const rows: [number, number][] = [
      [22_500_000, 1_500_000], [22_000_000, 1_500_000],
      [18_500_000, 500_000], [18_500_000, 500_000],
      [22_000_000, 2_000_000], [22_000_000, 500_000], [22_000_000, 500_000], [22_000_000, 500_000],
      [31_500_000, 2_000_000], [29_800_000, 2_000_000], [29_200_000, 2_000_000], [29_800_000, 2_000_000],
      [31_500_000, 2_500_000], [31_500_000, 2_000_000], [31_500_000, 2_000_000], [29_200_000, 2_000_000],
    ];
    let uza = 0, bank = 0;
    for (const [price, client] of rows) {
      const s = scenario({ vehiclePriceRwf: price, clientContributionRwf: client, tenorMonths: 60, lenderKey: 'unguka' });
      uza += s.split.uzaCollateralRwf;
      bank += s.split.bankLoanRwf;
    }
    expect(uza).toBe(17_350_000);
    expect(bank).toBe(372_150_000);
  });
});

describe('editing one number moves the others', () => {
  const base = { vehiclePriceRwf: 22_500_000, clientContributionRwf: 1_000_000, tenorMonths: 60, lenderKey: 'unguka' };

  it('fixing the bank figure re-derives UZA (the analyst episode: bank 21.75M → UZA would have been −250k, so 0 and a shortfall)', () => {
    const s = scenario({ ...base, bankLoanRwf: 21_750_000 });
    expect(s.rule.uzaSource).toBe('derivedFromBank');
    expect(s.split.uzaCollateralRwf).toBe(0);
    // 1M + 21.75M = 22.75M > 22.5M: the split does not add up, and cover < 10%.
    expect(codes(s)).toContain('SPLIT_DOES_NOT_ADD_UP');
    expect(codes(s)).toContain('COVER_BELOW_REQUIRED');
    expect(s.bookable).toBe(false);
  });

  it('fixing the bank at 90% re-derives UZA as the gap', () => {
    const s = scenario({ ...base, bankLoanRwf: 20_250_000 });
    expect(s.split.uzaCollateralRwf).toBe(1_250_000);
    expect(s.bookable).toBe(true);
  });

  it('typing UZA over the rule re-derives the bank, and over-pledging is warned', () => {
    const s = scenario({ ...base, uzaCollateralRwf: 2_000_000 });
    expect(s.rule.uzaSource).toBe('override');
    expect(s.split.bankLoanRwf).toBe(19_500_000);
    expect(codes(s)).toContain('UZA_ABOVE_GAP');
  });

  it('a client above the 10% needs no UZA and the bank lends less', () => {
    const s = scenario({ ...base, clientContributionRwf: 5_000_000 });
    expect(s.split.uzaCollateralRwf).toBe(0);
    expect(s.split.bankLoanRwf).toBe(17_500_000);
    expect(codes(s)).toContain('CLIENT_ABOVE_REQUIRED');
  });

  it('changing the contribution percentage moves required, UZA and the bank together', () => {
    const s = scenario({ ...base, contributionPct: 15 });
    expect(s.rule.requiredContributionRwf).toBe(3_375_000);
    expect(s.split.uzaCollateralRwf).toBe(2_375_000);
    expect(s.split.bankLoanRwf).toBe(19_125_000);
    expect(s.rule.contributionPctSource).toBe('override');
  });

  it('a shorter tenor picks the lower Unguka band and costs more per day', () => {
    const long = scenario(base);
    const short = scenario({ ...base, tenorMonths: 36 });
    expect(long.rule.annualRateBps).toBe(3600);
    expect(short.rule.annualRateBps).toBe(3400);
    expect(short.schedule!.dailyRwf).toBeGreaterThan(long.schedule!.dailyRwf);
    expect(short.schedule!.totalInterestRwf).toBeLessThan(long.schedule!.totalInterestRwf);
  });

  it('a typed rate overrides the band', () => {
    const s = scenario({ ...base, annualRateBps: 2400 });
    expect(s.rule.rateSource).toBe('override');
    expect(s.schedule!.annualRateBps).toBe(2400);
  });
});

describe('lenders without a rate on file', () => {
  it('sizes the split but refuses to quote until a rate is typed', () => {
    const s = scenario({ vehiclePriceRwf: 22_500_000, clientContributionRwf: 2_250_000, tenorMonths: 60, lenderKey: 'equity' });
    expect(s.split.bankLoanRwf).toBe(20_250_000);
    expect(s.schedule).toBeNull();
    expect(codes(s)).toContain('RATE_MISSING');
    expect(codes(s)).toContain('TERMS_UNVERIFIED');
    expect(s.bookable).toBe(false);
  });
  it('warns that UZA collateral is not available with that lender', () => {
    const s = scenario({ vehiclePriceRwf: 22_500_000, clientContributionRwf: 1_000_000, tenorMonths: 60, lenderKey: 'equity', annualRateBps: 2000 });
    expect(codes(s)).toContain('NO_UZA_FACILITY_WITH_LENDER');
  });
  it('an unknown lender blocks', () => {
    expect(scenario({ vehiclePriceRwf: 1, clientContributionRwf: 0, tenorMonths: 12, lenderKey: 'nope' }).bookable).toBe(false);
  });
});

describe('studies', () => {
  const input = { vehiclePriceRwf: 22_500_000, clientContributionRwf: 1_500_000, tenorMonths: 60, lenderKey: 'unguka' };
  it('byRate is centred on the agreed rate with zero delta', () => {
    const st = study(input);
    const centre = st.byRate.find((p) => p.label === 'Agreed rate')!;
    expect(centre.dailyDeltaRwf).toBe(0);
    expect(st.byRate[0].dailyDeltaRwf!).toBeLessThan(0);
    expect(st.byRate[4].dailyDeltaRwf!).toBeGreaterThan(0);
  });
  it('the contribution ladder is monotone: more client money, lower daily figure', () => {
    const st = study(input);
    const dailies = st.byClientContribution.map((p) => p.scenario.schedule?.dailyRwf ?? Infinity);
    for (let i = 1; i < dailies.length; i++) expect(dailies[i]).toBeLessThanOrEqual(dailies[i - 1]);
  });
  it('byLender covers every lender at every offered tenor', () => {
    const st = study(input);
    expect(st.byLender.map((p) => p.label)).toContain('Unguka Bank (LOLC) · 36 months');
    expect(st.byLender.map((p) => p.label)).toContain('Equity Bank Rwanda · 48 months');
  });
  it('the borrower copy carries no rate anywhere', () => {
    const b = forBorrower(study(input));
    const all = [b.base, ...[...b.byLender, ...b.byTenor, ...b.byRate, ...b.byClientContribution].map((p) => p.scenario)];
    for (const s of all) {
      expect(s.rule.annualRateBps).toBeNull();
      if (s.schedule) expect(s.schedule.annualRateBps).toBe(0);
    }
    expect(b.byRate.map((p) => p.label)).toEqual(['Much easier terms', 'Easier terms', 'Terms as agreed', 'Harder terms', 'Much harder terms']);
    expect(JSON.stringify(b)).not.toMatch(/"annualRateBps":3[46]00/);
  });
});

describe('properties', () => {
  const arb = fc.record({
    vehiclePriceRwf: fc.integer({ min: 1_000_000, max: 80_000_000 }),
    clientContributionRwf: fc.integer({ min: 0, max: 20_000_000 }),
    tenorMonths: fc.constantFrom(36, 60),
  });
  it('under the rule the split always adds up to the price and cover is never below 10%', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const s = scenario({ ...i, lenderKey: 'unguka' });
        const { clientContributionRwf: c, uzaCollateralRwf: u, bankLoanRwf: b } = s.split;
        expect(c + u + b).toBe(s.inputs.vehiclePriceRwf);
        if (b > 0) expect(c + u).toBeGreaterThanOrEqual(s.rule.requiredContributionRwf);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(codes(s)).not.toContain('SPLIT_DOES_NOT_ADD_UP');
      }),
    );
  });
  it('UZA never pledges more than the 10% itself', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const s = scenario({ ...i, lenderKey: 'unguka' });
        expect(s.split.uzaCollateralRwf).toBeLessThanOrEqual(s.rule.requiredContributionRwf);
      }),
    );
  });
  it('the seller receives the price less UZA\'s pledge, exactly', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const s = scenario({ ...i, lenderKey: 'unguka' });
        expect(s.split.sellerReceivesRwf).toBe(s.inputs.vehiclePriceRwf - s.split.uzaCollateralRwf);
      }),
    );
  });
});
