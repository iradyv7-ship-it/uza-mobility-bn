import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertAllocationAllowed,
  bucketBalances,
  momoIdempotencyKey,
  performance,
  splitDeposit,
  type LedgerLine,
} from './wallet.rules';

const NOW = new Date('2026-12-10T18:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const credit = (
  bucket: LedgerLine['bucket'],
  amountRwf: number,
  daysAgo: number,
  confirmed = true,
): LedgerLine => ({
  bucket,
  direction: 'CREDIT',
  amountRwf,
  occurredAt: day(daysAgo),
  confirmedAt: confirmed ? day(daysAgo) : null,
  recordedBy: confirmed ? 'INSTITUTION' : 'DRIVER',
  reason: 'MOMO_DEPOSIT',
});

describe('bucket balances', () => {
  it('keeps confirmed and pending apart, per bucket', () => {
    const b = bucketBalances([
      credit('LOAN', 30_000, 1),
      credit('LOAN', 30_000, 0, false),
      credit('MAINTENANCE', 5_000, 1),
      { ...credit('MAINTENANCE', 2_000, 0), direction: 'DEBIT' },
    ]);
    const loan = b.find((x) => x.bucket === 'LOAN')!;
    const maint = b.find((x) => x.bucket === 'MAINTENANCE')!;
    expect(loan).toMatchObject({
      confirmedRwf: 30_000,
      pendingRwf: 30_000,
      totalRwf: 60_000,
    });
    expect(maint).toMatchObject({ confirmedRwf: 3_000, pendingRwf: 0 });
    expect(b.find((x) => x.bucket === 'PERSONAL')!.totalRwf).toBe(0);
  });
});

describe('splitting a day’s money', () => {
  const split = {
    LOAN: 60,
    MAINTENANCE: 10,
    CHARGING: 15,
    INSURANCE: 5,
    PERSONAL: 10,
  };

  it('pays the car first and gives the rounding remainder to the loan', () => {
    const s = splitDeposit(30_001, split);
    expect(s.MAINTENANCE).toBe(3_000);
    expect(s.CHARGING).toBe(4_500);
    expect(s.INSURANCE).toBe(1_500);
    expect(s.PERSONAL).toBe(3_000);
    expect(s.LOAN).toBe(30_001 - 12_000);
    expect(Object.values(s).reduce((t, v) => t + v, 0)).toBe(30_001);
  });

  it('refuses a split that does not add up', () => {
    expect(() => splitDeposit(1_000, { ...split, PERSONAL: 20 })).toThrow(
      /adds up to 110%/,
    );
  });
});

describe('moving a label between buckets', () => {
  const balances = bucketBalances([
    credit('MAINTENANCE', 20_000, 3),
    credit('MAINTENANCE', 50_000, 0, false),
    credit('LOAN', 90_000, 2),
  ]);

  it('lets a driver move confirmed money between their own buckets', () => {
    expect(() =>
      assertAllocationAllowed(
        'MAINTENANCE',
        'PERSONAL',
        20_000,
        balances,
        'DRIVER',
      ),
    ).not.toThrow();
  });

  it('never lets a driver move money OUT of the loan bucket, and tells them what to press instead', () => {
    expect(() =>
      assertAllocationAllowed('LOAN', 'PERSONAL', 1_000, balances, 'DRIVER'),
    ).toThrow(/I need help before I miss a payment/);
  });

  it('lets staff move it, because a restructure is a conversation, not a button', () => {
    expect(() =>
      assertAllocationAllowed('LOAN', 'MAINTENANCE', 1_000, balances, 'STAFF'),
    ).not.toThrow();
  });

  it('does not let pending money be moved — a claim is not a balance', () => {
    expect(() =>
      assertAllocationAllowed(
        'MAINTENANCE',
        'CHARGING',
        30_000,
        balances,
        'DRIVER',
      ),
    ).toThrow(/Only RWF 20,000 is confirmed/);
  });

  it('refuses nonsense', () => {
    expect(() =>
      assertAllocationAllowed('LOAN', 'LOAN', 1, balances, 'STAFF'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertAllocationAllowed('CHARGING', 'LOAN', 0, balances, 'DRIVER'),
    ).toThrow(BadRequestException);
  });
});

describe('the 90-day behaviour statement', () => {
  it('counts only confirmed deposits in the loan-facing buckets, by calendar day', () => {
    const lines = [
      ...Array.from({ length: 30 }, (_, i) => credit('LOAN', 30_000, i)),
      credit('PERSONAL', 500_000, 5), // theirs; not evidence
      credit('LOAN', 30_000, 40, false), // pending; not evidence
    ];
    const p = performance(lines, 29_393, 2_350_000, NOW);
    expect(p.daysWithAnyDeposit).toBe(30);
    expect(p.daysHit).toBe(30);
    expect(p.currentStreak).toBe(30);
    expect(p.totalConfirmedRwf).toBe(900_000);
    expect(p.totalPendingRwf).toBe(30_000);
    expect(p.progressPct).toBe(38.3);
  });

  it('measures consistency against working days, so a rest day is not a miss', () => {
    // 26 of every 30 days for 90 days = 78 working days; deposit on exactly 78 days.
    const lines = Array.from({ length: 78 }, (_, i) =>
      credit('LOAN', 30_000, i),
    );
    expect(performance(lines, 30_000, null, NOW).consistencyRatio).toBe(1);
  });

  it('breaks the streak on a missed day and remembers the longest', () => {
    const lines = [
      credit('LOAN', 30_000, 0),
      credit('LOAN', 30_000, 1),
      credit('LOAN', 30_000, 3),
      credit('LOAN', 30_000, 4),
      credit('LOAN', 30_000, 5),
    ];
    const p = performance(lines, 30_000, null, NOW);
    expect(p.currentStreak).toBe(2);
    expect(p.longestStreak).toBe(3);
  });

  it('a deposit below the target counts as a day with a deposit but not a hit', () => {
    const p = performance([credit('LOAN', 10_000, 0)], 30_000, null, NOW);
    expect(p.daysWithAnyDeposit).toBe(1);
    expect(p.daysHit).toBe(0);
  });
});

describe('the MoMo idempotency key', () => {
  it('is the transaction id, normalised, once', () => {
    expect(momoIdempotencyKey(' 12345678901 ')).toBe('momo:12345678901');
    expect(momoIdempotencyKey('abc 123 456')).toBe('momo:ABC123456');
    expect(() => momoIdempotencyKey('12')).toThrow(/confirmation SMS/);
  });
});
