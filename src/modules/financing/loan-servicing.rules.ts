/**
 * Loan servicing — the arithmetic after disbursement, as pure functions.
 *
 * The schedule is the one the lender quoted: `monthlyRwf` for `tenorMonths` months, the first
 * instalment due 30 days after disbursement, the total `totalRepayableRwf`. Servicing does
 * not amortise or re-quote; it only answers three questions from the record of repayments:
 *
 *   what remains        outstanding = max(0, totalRepayable − paid)
 *   what is overdue     arrears     = max(0, min(totalRepayable, monthly × monthsDue) − paid)
 *   what state it is in DISBURSED until the first month is due, then ACTIVE or IN_ARREARS,
 *                       CLOSED once closed.
 *
 * Thirty-day months, because that is what the lender's daily figure (`dailyRwf`) already
 * assumes — see empower-support.rules.ts. A driver paying the daily target every working day
 * is never in arrears under this rule, which is the point of the daily target.
 */

export const DAYS_PER_MONTH = 30;
const DAY = 86_400_000;

export interface ServicingInput {
  totalRepayableRwf: number;
  monthlyRwf: number;
  tenorMonths: number;
  paidRwf: number;
  disbursedAt: Date | null;
  closedAt: Date | null;
  now: Date;
}

export type ServicedStatus = 'DISBURSED' | 'ACTIVE' | 'IN_ARREARS' | 'CLOSED';

export interface ServicingResult {
  outstandingRwf: number;
  arrearsRwf: number;
  /** Instalments that have fallen due so far (0 before day 30). */
  monthsDue: number;
  /** Arrears expressed in whole instalments, rounded down — what a credit officer says aloud. */
  instalmentsBehind: number;
  status: ServicedStatus;
}

export function monthsDue(
  disbursedAt: Date,
  now: Date,
  tenorMonths: number,
): number {
  const days = Math.floor((now.getTime() - disbursedAt.getTime()) / DAY);
  if (days < DAYS_PER_MONTH) return 0;
  return Math.min(tenorMonths, Math.floor(days / DAYS_PER_MONTH));
}

export function service(input: ServicingInput): ServicingResult {
  const paid = Math.max(0, input.paidRwf);
  const outstandingRwf = Math.max(0, input.totalRepayableRwf - paid);

  if (input.closedAt) {
    return {
      outstandingRwf,
      arrearsRwf: 0,
      monthsDue: input.tenorMonths,
      instalmentsBehind: 0,
      status: 'CLOSED',
    };
  }
  if (!input.disbursedAt) {
    throw new Error('service() is for disbursed loans only');
  }

  const due = monthsDue(input.disbursedAt, input.now, input.tenorMonths);
  const expected = Math.min(input.totalRepayableRwf, input.monthlyRwf * due);
  const arrearsRwf = Math.max(0, expected - paid);
  const instalmentsBehind =
    input.monthlyRwf > 0 ? Math.floor(arrearsRwf / input.monthlyRwf) : 0;

  const status: ServicedStatus =
    due === 0 ? 'DISBURSED' : arrearsRwf > 0 ? 'IN_ARREARS' : 'ACTIVE';

  return {
    outstandingRwf,
    arrearsRwf,
    monthsDue: due,
    instalmentsBehind,
    status,
  };
}

/** A repayment file row, whatever the bank called the columns. */
export interface RepaymentRow {
  loanRef: string;
  amountRwf: number;
  paidAt: Date;
  reference: string;
}

const pick = (r: Record<string, unknown>, names: string[]): string => {
  const keys = Object.keys(r);
  for (const n of names) {
    const k = keys.find(
      (x) =>
        x
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, ' ') === n,
    );
    const v = k !== undefined ? r[k] : undefined;
    if (v === null || v === undefined) continue;
    // Cells arrive as strings, numbers or Dates; anything richer is not a value we can use.
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toISOString();
  }
  return '';
};

/**
 * Normalise a bank's rows. Column names are matched loosely — "Loan", "Loan ref", "Loan
 * reference"; "Amount", "Amount (RWF)", "Paid"; "Date", "Paid at", "Value date"; "Reference",
 * "Ref", "Transaction", "Receipt". A row with a problem is reported, not skipped silently.
 */
export function normaliseRepaymentRows(rows: Record<string, unknown>[]): {
  ok: RepaymentRow[];
  errors: { row: number; problem: string }[];
} {
  const ok: RepaymentRow[] = [];
  const errors: { row: number; problem: string }[] = [];
  rows.forEach((r, i) => {
    const loanRef = pick(r, [
      'loan',
      'loan ref',
      'loan reference',
      'reference no',
      'loanref',
    ]);
    const amountRaw = pick(r, [
      'amount',
      'amount (rwf)',
      'amount rwf',
      'paid',
      'paid rwf',
      'amountrwf',
    ]);
    const dateRaw = pick(r, [
      'date',
      'paid at',
      'value date',
      'payment date',
      'paidat',
    ]);
    const reference = pick(r, [
      'reference',
      'ref',
      'transaction',
      'transaction id',
      'receipt',
      'txn',
    ]);
    const amountRwf = Math.round(
      Number(amountRaw.replace(/[,\s]/g, '').replace(/rwf/i, '')),
    );
    const paidAt = new Date(dateRaw);
    const problems: string[] = [];
    if (!loanRef) problems.push('no loan reference');
    if (!Number.isFinite(amountRwf) || amountRwf <= 0)
      problems.push(`amount "${amountRaw}" is not a positive number`);
    if (Number.isNaN(paidAt.getTime()))
      problems.push(`date "${dateRaw}" is not a date`);
    if (!reference)
      problems.push(
        'no transaction reference (needed so the file can be imported twice safely)',
      );
    if (problems.length)
      errors.push({ row: i + 2, problem: problems.join('; ') });
    else ok.push({ loanRef, amountRwf, paidAt, reference });
  });
  return { ok, errors };
}
