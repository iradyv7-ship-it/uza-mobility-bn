import { BadRequestException } from '@nestjs/common';

/**
 * The wallet's rules, as pure functions over ledger lines.
 *
 * ── WHAT THE WALLET IS, LEGALLY ─────────────────────────────────────────────────────────
 *
 * UZA never holds client money. The wallet is a LEDGER VIEW over funds that sit in the
 * client's own account at a licensed institution. UZA supplies the software and the
 * arithmetic as a technical service provider — the exemption in the PSP regime for
 * providers that never enter into possession of the funds (Regulation N° 74/2023; the
 * architecture decision in `02-uza-empower-program.md` §3.2). The instalment reaches the
 * loan account under the client's OWN standing instruction to their bank (`SweepMandate`),
 * executed by the bank. UZA computes and displays; the bank moves the money.
 *
 * A "bucket" is therefore a purpose label the client puts on their own balance, and an
 * "allocation" moves a label, not a franc. That is exactly why it is safe to let the client
 * do it themselves, and why it works: labelled and commitment savings raise saving (Ashraf,
 * Karlan & Yin 2006 — SEED, +81% balances; Dupas & Robinson 2013 — earmarking). The four
 * buckets the driver sees are the four things the car needs money for, plus their own.
 *
 * ── TWO STATES A LINE CAN BE IN ─────────────────────────────────────────────────────────
 *
 * There is no consumer MoMo transaction API in Rwanda, so a deposit the driver records is
 * a CLAIM with a reference until it is matched to the institution's statement. Both states
 * are shown; only confirmed lines count in anything a lender reads. Pretending otherwise
 * would make the 90-day record worthless to the one reader it exists for.
 */

export type Bucket =
  'LOAN' | 'MAINTENANCE' | 'CHARGING' | 'INSURANCE' | 'PERSONAL';
export const BUCKETS: readonly Bucket[] = [
  'LOAN',
  'MAINTENANCE',
  'CHARGING',
  'INSURANCE',
  'PERSONAL',
];

/**
 * What each bucket is, in the words the driver sees. Kinyarwanda from
 * `03-uza-empower/training/kinyarwanda-glossary.md` — proposals pending native review; the
 * glossary carries the reasoning for each word, so correct it there and copy here.
 */
export const BUCKET_LABELS: Record<
  Bucket,
  { en: string; rw: string; purpose: string; purposeRw: string }
> = {
  LOAN: {
    en: 'Loan',
    rw: 'Inguzanyo',
    purpose: 'The instalment. First call on every day’s money.',
    purposeRw: 'Icyo wishyura buri munsi. Kibanza.',
  },
  MAINTENANCE: {
    en: 'Maintenance',
    rw: 'Kubungabunga',
    purpose: 'The next tyre, the service, the monthly inspection.',
    purposeRw: 'Ipine itaha, na garage.',
  },
  CHARGING: {
    en: 'Charging',
    rw: 'Umuriro',
    purpose: 'Energy — what fuel money used to be.',
    purposeRw: 'Aho lisansi yajyaga.',
  },
  INSURANCE: {
    en: 'Insurance',
    rw: 'Ubwishingizi',
    purpose: 'The quarterly instalment on the premium.',
    purposeRw: 'Ubwishingizi bwa buri gihembwe.',
  },
  PERSONAL: {
    en: 'My savings',
    rw: 'Ubwizigame bwanjye',
    purpose: 'Yours. Never swept, never touched by UZA.',
    purposeRw: 'Ni ayawe. Nta wuyakoraho.',
  },
};

export interface LedgerLine {
  bucket: Bucket | null;
  direction: 'CREDIT' | 'DEBIT';
  amountRwf: number;
  occurredAt: Date;
  confirmedAt: Date | null;
  recordedBy: 'DRIVER' | 'STAFF' | 'INSTITUTION';
  reason: string;
}

export interface BucketBalance {
  bucket: Bucket;
  /** Confirmed by the institution's statement. What a lender may read. */
  confirmedRwf: number;
  /** Recorded but not yet matched. Shown to the driver as "waiting for the bank". */
  pendingRwf: number;
  totalRwf: number;
}

export function bucketBalances(lines: readonly LedgerLine[]): BucketBalance[] {
  return BUCKETS.map((bucket) => {
    const mine = lines.filter((l) => l.bucket === bucket);
    const sum = (pred: (l: LedgerLine) => boolean) =>
      mine
        .filter(pred)
        .reduce(
          (t, l) => t + (l.direction === 'CREDIT' ? l.amountRwf : -l.amountRwf),
          0,
        );
    const confirmedRwf = sum((l) => l.confirmedAt !== null);
    const pendingRwf = sum((l) => l.confirmedAt === null);
    return {
      bucket,
      confirmedRwf,
      pendingRwf,
      totalRwf: confirmedRwf + pendingRwf,
    };
  });
}

export interface Split {
  LOAN: number;
  MAINTENANCE: number;
  CHARGING: number;
  INSURANCE: number;
  PERSONAL: number;
}

export function assertSplitSumsTo100(split: Split): void {
  const total = (Object.values(split) as number[]).reduce((t, v) => t + v, 0);
  if (total !== 100) {
    throw new BadRequestException(
      `The split must add up to 100%. It adds up to ${total}%.`,
    );
  }
  for (const [k, v] of Object.entries(split)) {
    if (!Number.isInteger(v) || v < 0)
      throw new BadRequestException(
        `${k} must be a whole percentage from 0 to 100.`,
      );
  }
}

/**
 * Split one deposit across buckets by percentage, whole francs, remainder to LOAN.
 *
 * LOAN takes the rounding remainder because it is the first call on the day's money and
 * because a driver who is RWF 3 short on the instalment because of rounding is a driver
 * who was let down by arithmetic.
 */
export function splitDeposit(
  amountRwf: number,
  split: Split,
): Record<Bucket, number> {
  assertSplitSumsTo100(split);
  if (!Number.isInteger(amountRwf) || amountRwf <= 0) {
    throw new BadRequestException(
      'A deposit is a positive whole number of francs.',
    );
  }
  const out = {} as Record<Bucket, number>;
  let allocated = 0;
  for (const b of BUCKETS) {
    if (b === 'LOAN') continue;
    out[b] = Math.floor((amountRwf * split[b]) / 100);
    allocated += out[b];
  }
  out.LOAN = amountRwf - allocated;
  return out;
}

/**
 * Moving a label between buckets. No money moves; the institution's balance is unchanged.
 *
 * Two guards, both about the loan. Nothing may be moved OUT of LOAN by the driver — the
 * instalment is the one bucket whose purpose is a promise to somebody else, and a driver
 * under pressure on a bad day must not be able to quietly unlabel it (they may call, and a
 * staff member may re-allocate with the reason recorded). And a move may not exceed what
 * the source bucket actually holds in confirmed funds — pending money is a claim, not a
 * balance.
 */
export function assertAllocationAllowed(
  from: Bucket,
  to: Bucket,
  amountRwf: number,
  balances: readonly BucketBalance[],
  actor: 'DRIVER' | 'STAFF',
): void {
  if (from === to)
    throw new BadRequestException('Choose two different buckets.');
  if (!Number.isInteger(amountRwf) || amountRwf <= 0) {
    throw new BadRequestException(
      'An allocation is a positive whole number of francs.',
    );
  }
  if (from === 'LOAN' && actor === 'DRIVER') {
    throw new BadRequestException(
      'Money set aside for the loan can only be moved by UZA, with a reason. If this week is short, press "I need help before I miss a payment" — somebody will call you today.',
    );
  }
  const source = balances.find((b) => b.bucket === from);
  const available = source?.confirmedRwf ?? 0;
  if (amountRwf > available) {
    throw new BadRequestException(
      `Only RWF ${available.toLocaleString('en-RW')} is confirmed in ${BUCKET_LABELS[from].en}. Money the bank has not confirmed yet cannot be moved.`,
    );
  }
}

// ── The record a lender reads ──────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface DailyRecord {
  date: string;
  /** Confirmed by the institution. The only figure that is evidence for anyone. */
  depositedRwf: number;
  /**
   * Entered by the driver (MoMo transaction ID) but not yet confirmed by staff against the
   * bank file. Not evidence — but not a miss either, for as long as the reconciliation hold
   * lasts (see covenant.rules.ts). Without this field a bank that confirms on Tuesday what
   * the driver paid on Saturday would produce a false warning on Monday morning.
   */
  pendingRwf: number;
  targetRwf: number;
  hit: boolean;
}

export interface Performance {
  windowDays: number;
  /** Days the CONFIRMED deposits met the daily target. */
  daysHit: number;
  daysWithAnyDeposit: number;
  /** daysHit / working days in the window (26/30 of calendar days), 0–1. What the score uses. */
  consistencyRatio: number;
  /** Consecutive days up to and including yesterday with a confirmed deposit. */
  currentStreak: number;
  longestStreak: number;
  totalConfirmedRwf: number;
  totalPendingRwf: number;
  averageDailyRwf: number;
  /** Against the contribution target, confirmed only. 0–100. */
  progressPct: number | null;
  daily: DailyRecord[];
}

/**
 * The 90-day behaviour statement. Deposits are counted by calendar day of `occurredAt`,
 * CONFIRMED lines only, in the buckets that count toward the loan (everything but PERSONAL —
 * a driver's own savings are theirs and are not evidence for anyone).
 *
 * Consistency is against WORKING days (26 of every 30) because that is the unit the target
 * is quoted in; a driver who rests on Sunday has not missed anything.
 */
export function performance(
  lines: readonly LedgerLine[],
  dailyTargetRwf: number | null,
  contributionTargetRwf: number | null,
  now: Date,
  windowDays = 90,
): Performance {
  const start = new Date(now.getTime() - (windowDays - 1) * DAY);
  const byDay = new Map<string, number>();
  const pendingByDay = new Map<string, number>();
  let pending = 0;
  for (const l of lines) {
    if (
      l.direction !== 'CREDIT' ||
      l.bucket === 'PERSONAL' ||
      l.bucket === null
    )
      continue;
    if (l.occurredAt < start || l.occurredAt > now) continue;
    const k = ymd(l.occurredAt);
    if (!l.confirmedAt) {
      pending += l.amountRwf;
      pendingByDay.set(k, (pendingByDay.get(k) ?? 0) + l.amountRwf);
      continue;
    }
    byDay.set(k, (byDay.get(k) ?? 0) + l.amountRwf);
  }

  const target = dailyTargetRwf ?? 0;
  const daily: DailyRecord[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const k = ymd(d);
    const dep = byDay.get(k) ?? 0;
    daily.push({
      date: k,
      depositedRwf: dep,
      pendingRwf: pendingByDay.get(k) ?? 0,
      targetRwf: target,
      hit: target > 0 ? dep >= target : dep > 0,
    });
  }

  // Streaks are the driver's own record of showing up, so a day whose deposit is still
  // waiting for the bank keeps the streak — the driver did their part. The ratio below stays
  // confirmed-only, because that one is read by lenders.
  const kept = (r: DailyRecord) => r.depositedRwf > 0 || r.pendingRwf > 0;
  let longest = 0,
    run = 0;
  for (const r of daily) {
    run = kept(r) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Current streak: count back from yesterday (today may still be in progress).
  let current = 0;
  for (let i = daily.length - 2; i >= 0; i--) {
    if (kept(daily[i])) current += 1;
    else break;
  }
  if (kept(daily.at(-1)!)) current += 1;

  const totalConfirmed = daily.reduce((t, r) => t + r.depositedRwf, 0);
  const workingDays = Math.round((windowDays * 26) / 30);
  const daysHit = daily.filter((r) => r.hit).length;
  const allConfirmedInLoanBuckets = lines
    .filter((l) => l.confirmedAt && l.bucket && l.bucket !== 'PERSONAL')
    .reduce(
      (t, l) => t + (l.direction === 'CREDIT' ? l.amountRwf : -l.amountRwf),
      0,
    );

  return {
    windowDays,
    daysHit,
    daysWithAnyDeposit: daily.filter((r) => r.depositedRwf > 0).length,
    consistencyRatio: Math.min(
      1,
      Math.round((daysHit / workingDays) * 1000) / 1000,
    ),
    currentStreak: current,
    longestStreak: longest,
    totalConfirmedRwf: totalConfirmed,
    totalPendingRwf: pending,
    averageDailyRwf: Math.round(totalConfirmed / windowDays),
    progressPct: contributionTargetRwf
      ? Math.min(
          100,
          Math.round(
            (allConfirmedInLoanBuckets / contributionTargetRwf) * 1000,
          ) / 10,
        )
      : null,
    daily,
  };
}

/** The idempotency key for a driver-recorded MoMo deposit: the transaction id, once. */
export function momoIdempotencyKey(momoTransactionId: string): string {
  const id = momoTransactionId.trim().toUpperCase().replace(/\s+/g, '');
  if (id.length < 6)
    throw new BadRequestException(
      'Enter the MoMo transaction ID from the confirmation SMS.',
    );
  return `momo:${id}`;
}

// ── The road to the contribution ───────────────────────────────────────────────────────

export interface ContributionProgress {
  targetRwf: number | null;
  /** The driver's own confirmed savings in the loan-facing buckets, net of debits. */
  savedRwf: number;
  /** UZA's credits toward the contribution — earn-in, grants — not held money. */
  creditRwf: number;
  totalRwf: number;
  pct: number | null;
  remainingRwf: number | null;
  /** At the last 30 days' confirmed pace, how many working days until the target. null = no pace yet. */
  workingDaysToTarget: number | null;
}

/**
 * How far a driver is from the 10%, counting both what they saved and what UZA has credited
 * toward it — shown side by side, never merged into one number a lender could mistake for
 * cash. The pace is the last 30 days of confirmed deposits over 26 working days, so a driver
 * who started this week sees an honest, changing estimate rather than a promise.
 */
export function contributionProgress(
  perf: Pick<Performance, 'daily'>,
  lines: readonly LedgerLine[],
  contributionTargetRwf: number | null,
  creditRwf: number,
): ContributionProgress {
  // Instalments swept to the lender are the loan being repaid, not the contribution being
  // un-saved; they are left out, so a driver's "toward the 10%" never falls because they paid.
  const savedRwf = lines
    .filter(
      (l) =>
        l.confirmedAt &&
        l.bucket &&
        l.bucket !== 'PERSONAL' &&
        l.reason !== 'INSTALMENT_SWEEP',
    )
    .reduce(
      (t, l) => t + (l.direction === 'CREDIT' ? l.amountRwf : -l.amountRwf),
      0,
    );
  const totalRwf = Math.max(0, savedRwf) + Math.max(0, creditRwf);
  const target = contributionTargetRwf ?? null;
  const remainingRwf = target == null ? null : Math.max(0, target - totalRwf);
  const last30 = perf.daily.slice(-30).reduce((t, d) => t + d.depositedRwf, 0);
  const paceRwfPerWorkingDay = last30 / 26;
  const workingDaysToTarget =
    remainingRwf == null
      ? null
      : remainingRwf === 0
        ? 0
        : paceRwfPerWorkingDay > 0
          ? Math.ceil(remainingRwf / paceRwfPerWorkingDay)
          : null;
  return {
    targetRwf: target,
    savedRwf: Math.max(0, savedRwf),
    creditRwf: Math.max(0, creditRwf),
    totalRwf,
    pct:
      target && target > 0
        ? Math.min(100, Math.round((totalRwf / target) * 1000) / 10)
        : null,
    remainingRwf,
    workingDaysToTarget,
  };
}
