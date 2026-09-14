import type { DailyRecord } from './wallet.rules';

/**
 * The covenant engine — what a lender was promised in exchange for better terms.
 *
 * NCBA lends at 18% with no cash collateral on the strength of three things: mandatory
 * training, a mandatory monthly inspection, and visibility of the borrower's daily savings
 * with a WARNING when they stop. Yves, 12 September 2026: "create a system around this."
 * This is that system, as pure rules over the records the platform already keeps. It runs
 * every morning and on demand, and it produces the same warning on the driver's screen, on
 * UZA's, and — where the borrower consented — on the lender's.
 *
 * ── THE RULES ──────────────────────────────────────────────────────────────────────────
 *
 *  Missed deposits    A working day with no confirmed deposit is a MISS. Sunday is not.
 *                     1 miss  → NOTICE   to the driver only ("today is not recorded yet")
 *                     2 misses in a row → WARNING to driver + UZA ("call before you miss")
 *                     3 misses in a row → ALERT   to driver + UZA + lender
 *                     5+ in 7 days       → ALERT, and UZA's month-3 coaching is triggered
 *
 *  Reconciliation     A day on which the driver entered a deposit that staff have not yet
 *  hold               confirmed against the bank file is HELD, not missed, for up to
 *                     RECONCILIATION_HOLD_WORKING_DAYS. A held day is skipped like a
 *                     Sunday: it neither breaks a run of misses nor ends one. A bank that
 *                     confirms on Tuesday what was paid on Saturday must not produce a
 *                     Monday-morning alert to a lender. Past the hold the day counts as a
 *                     miss again — a claimed deposit is not a deposit — and UZA gets a
 *                     WARNING of its own (DEPOSIT_UNRECONCILED), because a deposit still
 *                     unconfirmed after three working days is UZA's failure, not the
 *                     driver's. The driver is told the same, in reassuring words.
 *
 *  Short deposits     Deposits present but below target for 5 of the last 7 working days
 *                     → WARNING to driver + UZA. Not to the lender: the record shows it and
 *                     the instalment may still be met from the buffer.
 *
 *  Inspection         Monthly, mandatory. Overdue by 1–7 days → WARNING driver + UZA.
 *                     Overdue by 8+ days, or none on file 35 days after disbursement →
 *                     ALERT to all three. A failed inspection with an open SAFETY finding
 *                     is an ALERT the day it is filed.
 *
 *  Comprehension      A day-30 or day-90 re-test that falls → WARNING to UZA (coaching),
 *                     not to the lender directly; it reaches the lender in the training
 *                     summary they already read. This is the one rule that does not wait
 *                     for a live loan: training precedes disbursement, and coaching is
 *                     most useful before the first instalment.
 *
 * Severity decides the audience. Nothing reaches a lender at NOTICE. Nothing reaches a
 * lender at all without a live consent for that lender — the covenant is the borrower's
 * promise to the bank, and the borrower agreed to be watched keeping it; they did not
 * agree to be watched by anyone else.
 */

export type Severity = 'NOTICE' | 'WARNING' | 'ALERT';
export type Audience = 'DRIVER' | 'UZA' | 'LENDER';

/**
 * Working days a driver-entered deposit may wait for staff confirmation before it stops
 * shielding its day from being a miss. Three: MoMo statements reach UZA's finance desk the
 * next working day and a weekend deposit is confirmed by Tuesday. Longer, and a driver could
 * hold off every warning by typing transaction IDs.
 */
export const RECONCILIATION_HOLD_WORKING_DAYS = 3;

export interface Covenant {
  kind:
    | 'DEPOSIT_MISSED'
    | 'DEPOSIT_UNRECONCILED'
    | 'DEPOSIT_SHORT'
    | 'INSPECTION_OVERDUE'
    | 'INSPECTION_MISSING'
    | 'INSPECTION_FAILED_SAFETY'
    | 'COMPREHENSION_FALLING';
  severity: Severity;
  audience: Audience[];
  /** Plain, in the second person for the driver; the same text is what UZA and the lender see. */
  message: string;
  /** Machine-readable detail for the portals. */
  detail: Record<string, string | number | boolean | null>;
  /** Stable per day per kind, so the same condition does not notify twice in one day. */
  dedupeKey: string;
}

export function isWorkingDay(date: Date): boolean {
  // Sunday is the rest day. Six working days a week ≈ 26 a month, the unit the target is quoted in.
  return date.getUTCDay() !== 0;
}

export interface CovenantInput {
  now: Date;
  /** From `performance().daily`, oldest first, confirmed deposits only. */
  daily: readonly DailyRecord[];
  dailyTargetRwf: number | null;
  loan: {
    id: string;
    reference: string;
    disbursedAt: Date | null;
    status: string;
  } | null;
  inspection: {
    lastAt: Date | null;
    nextDueAt: Date | null;
    lastPassed: boolean | null;
    openSafetyFindings: number;
  };
  comprehension: {
    previousPct: number | null;
    latestPct: number | null;
  } | null;
}

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function evaluateCovenants(input: CovenantInput): Covenant[] {
  const out: Covenant[] = [];
  const today = ymd(input.now);
  const active =
    input.loan &&
    ['ACTIVE', 'IN_ARREARS', 'DISBURSED'].includes(input.loan.status);

  // ── Deposits: consecutive working-day misses, counting back from yesterday ──────────
  // Today is still in progress until the morning run of the next day, so a miss is only
  // final once the day has ended. Yesterday is the first day that can be a miss.
  //
  // Each past working day is one of three things. HIT: a confirmed deposit. HELD: nothing
  // confirmed, but the driver entered a deposit and it is still inside the reconciliation
  // hold — skipped, like a Sunday. MISS: nothing confirmed and nothing held.
  const days = [...input.daily];
  const yesterdayIdx = days.length - 2;
  const state = new Map<string, 'HIT' | 'HELD' | 'MISS'>();
  const staleHeld: DailyRecord[] = [];
  let workingDaysAgo = 0;
  for (let i = yesterdayIdx; i >= 0 && i >= yesterdayIdx - 13; i--) {
    const r = days[i];
    if (!isWorkingDay(new Date(r.date + 'T00:00:00Z'))) continue;
    workingDaysAgo += 1;
    if (r.depositedRwf > 0) {
      state.set(r.date, 'HIT');
    } else if (r.pendingRwf > 0) {
      if (workingDaysAgo <= RECONCILIATION_HOLD_WORKING_DAYS) {
        state.set(r.date, 'HELD');
      } else {
        state.set(r.date, 'MISS');
        staleHeld.push(r);
      }
    } else {
      state.set(r.date, 'MISS');
    }
  }

  let consecutive = 0;
  for (let i = yesterdayIdx; i >= 0 && i >= yesterdayIdx - 13; i--) {
    const st = state.get(days[i].date);
    if (!st || st === 'HELD') continue;
    if (st === 'HIT') break;
    consecutive += 1;
  }
  const last7 = days
    .slice(-8, -1)
    .filter((r) => isWorkingDay(new Date(r.date + 'T00:00:00Z')))
    .filter((r) => state.get(r.date) !== 'HELD');
  const missesIn7 = last7.filter((r) => state.get(r.date) === 'MISS').length;

  if (consecutive >= 1 && active) {
    const severity: Severity =
      consecutive >= 3 || missesIn7 >= 5
        ? 'ALERT'
        : consecutive >= 2
          ? 'WARNING'
          : 'NOTICE';
    const audience: Audience[] =
      severity === 'ALERT'
        ? ['DRIVER', 'UZA', 'LENDER']
        : severity === 'WARNING'
          ? ['DRIVER', 'UZA']
          : ['DRIVER'];
    const message =
      severity === 'NOTICE'
        ? 'No deposit was recorded yesterday. If you deposited, enter the MoMo transaction ID; if not, today counts.'
        : severity === 'WARNING'
          ? `No deposit for ${consecutive} working days in a row. Press "I need help before I miss a payment" — somebody at UZA will call you today. Calling now is what keeps this a conversation.`
          : `No deposit for ${consecutive} working days in a row${missesIn7 >= 5 ? ` and ${missesIn7} of the last 7` : ''}. Your lender can see this. UZA is calling you today.`;
    out.push({
      kind: 'DEPOSIT_MISSED',
      severity,
      audience,
      message,
      detail: {
        consecutiveMisses: consecutive,
        missesInLast7: missesIn7,
        loanRef: input.loan?.reference ?? null,
      },
      dedupeKey: `DEPOSIT_MISSED:${today}:${severity}`,
    });
  }

  // ── Deposits: entered by the driver, still unconfirmed past the hold ───────────────
  // This one is about UZA's desk, not the driver's behaviour. It goes to UZA as a WARNING
  // and to the driver as reassurance; never to the lender, who sees only the confirmed
  // record and, if the day is genuinely missed, the DEPOSIT_MISSED above.
  if (active && staleHeld.length) {
    const oldest = staleHeld[staleHeld.length - 1];
    const totalRwf = staleHeld.reduce((t, r) => t + r.pendingRwf, 0);
    out.push({
      kind: 'DEPOSIT_UNRECONCILED',
      severity: 'WARNING',
      audience: ['DRIVER', 'UZA'],
      message:
        staleHeld.length === 1
          ? `The deposit you entered on ${oldest.date} has not been confirmed by UZA yet. UZA is checking it against the bank now; you do not need to do anything.`
          : `${staleHeld.length} deposits you entered, the oldest on ${oldest.date}, have not been confirmed by UZA yet. UZA is checking them against the bank now; you do not need to do anything.`,
      detail: {
        unconfirmedDays: staleHeld.length,
        oldestDate: oldest.date,
        totalPendingRwf: totalRwf,
        holdWorkingDays: RECONCILIATION_HOLD_WORKING_DAYS,
        loanRef: input.loan?.reference ?? null,
      },
      dedupeKey: `DEPOSIT_UNRECONCILED:${today}`,
    });
  }

  // ── Deposits: present but short ─────────────────────────────────────────────────────
  if (active && input.dailyTargetRwf && last7.length >= 5) {
    const short = last7.filter(
      (r) => r.depositedRwf > 0 && r.depositedRwf < r.targetRwf,
    ).length;
    if (short >= 5) {
      out.push({
        kind: 'DEPOSIT_SHORT',
        severity: 'WARNING',
        audience: ['DRIVER', 'UZA'],
        message: `You deposited on ${short} of the last 7 working days but below your target of RWF ${input.dailyTargetRwf.toLocaleString('en-RW')}. The buffer covers a short day; it does not cover a short week.`,
        detail: { shortDays: short, dailyTargetRwf: input.dailyTargetRwf },
        dedupeKey: `DEPOSIT_SHORT:${today}`,
      });
    }
  }

  // ── Inspection: monthly, mandatory ─────────────────────────────────────────────────
  if (active && input.loan?.disbursedAt) {
    const { lastAt, nextDueAt, lastPassed, openSafetyFindings } =
      input.inspection;
    if (lastPassed === false && openSafetyFindings > 0) {
      out.push({
        kind: 'INSPECTION_FAILED_SAFETY',
        severity: 'ALERT',
        audience: ['DRIVER', 'UZA', 'LENDER'],
        message: `The last inspection found ${openSafetyFindings} open safety defect${openSafetyFindings === 1 ? '' : 's'}. The vehicle must not carry passengers until a certified garage clears it.`,
        detail: { openSafetyFindings },
        dedupeKey: `INSPECTION_FAILED_SAFETY:${today}`,
      });
    }
    if (!lastAt) {
      const daysSince = Math.floor(
        (input.now.getTime() - input.loan.disbursedAt.getTime()) / DAY,
      );
      if (daysSince >= 35) {
        out.push({
          kind: 'INSPECTION_MISSING',
          severity: 'ALERT',
          audience: ['DRIVER', 'UZA', 'LENDER'],
          message: `No inspection on file ${daysSince} days after the vehicle was handed over. The monthly inspection is a condition of the loan. Book a certified garage this week.`,
          detail: { daysSinceDisbursement: daysSince },
          dedupeKey: `INSPECTION_MISSING:${today}`,
        });
      }
    } else if (nextDueAt && input.now > nextDueAt) {
      const overdue = Math.floor(
        (input.now.getTime() - nextDueAt.getTime()) / DAY,
      );
      const severity: Severity = overdue >= 8 ? 'ALERT' : 'WARNING';
      out.push({
        kind: 'INSPECTION_OVERDUE',
        severity,
        audience:
          severity === 'ALERT'
            ? ['DRIVER', 'UZA', 'LENDER']
            : ['DRIVER', 'UZA'],
        message:
          severity === 'WARNING'
            ? `Your monthly inspection was due ${overdue} day${overdue === 1 ? '' : 's'} ago. Book a certified garage; take your UZA ID card.`
            : `Your monthly inspection is ${overdue} days overdue. Your lender can see this. UZA will help you book today.`,
        detail: { overdueDays: overdue, dueAt: ymd(nextDueAt) },
        dedupeKey: `INSPECTION_OVERDUE:${today}:${severity}`,
      });
    }
  }

  // ── Comprehension: a falling re-test is coaching, not a covenant breach ──────────────
  if (
    input.comprehension?.previousPct != null &&
    input.comprehension.latestPct != null
  ) {
    const drop =
      input.comprehension.previousPct - input.comprehension.latestPct;
    if (drop > 5) {
      out.push({
        kind: 'COMPREHENSION_FALLING',
        severity: 'WARNING',
        audience: ['UZA'],
        message: `Loan comprehension fell from ${input.comprehension.previousPct}% to ${input.comprehension.latestPct}% on re-test. Schedule coaching before the next instalment, not after.`,
        detail: {
          previousPct: input.comprehension.previousPct,
          latestPct: input.comprehension.latestPct,
        },
        dedupeKey: `COMPREHENSION_FALLING:${today}`,
      });
    }
  }

  return out;
}

/** The highest severity present, for a portal badge. */
export function worstOf(covenants: readonly Covenant[]): Severity | null {
  if (covenants.some((c) => c.severity === 'ALERT')) return 'ALERT';
  if (covenants.some((c) => c.severity === 'WARNING')) return 'WARNING';
  if (covenants.length) return 'NOTICE';
  return null;
}
