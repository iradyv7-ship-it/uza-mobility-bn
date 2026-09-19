import { describe, expect, it } from 'vitest';
import {
  monthsDue,
  normaliseRepaymentRows,
  service,
} from './loan-servicing.rules';

const D = (s: string) => new Date(s + 'T00:00:00Z');
// A Neta U Pro-shaped loan: RWF 21.15M financed, 60 months, ~RWF 764k a month.
const loan = {
  totalRepayableRwf: 45_840_000,
  monthlyRwf: 764_000,
  tenorMonths: 60,
  closedAt: null as Date | null,
};

describe('months due', () => {
  it('nothing is due before day 30', () => {
    expect(monthsDue(D('2026-10-01'), D('2026-10-30'), 60)).toBe(0);
    expect(monthsDue(D('2026-10-01'), D('2026-10-31'), 60)).toBe(1);
  });
  it('never exceeds the tenor', () => {
    expect(monthsDue(D('2020-01-01'), D('2030-01-01'), 60)).toBe(60);
  });
});

describe('servicing a disbursed loan', () => {
  it('on day zero: balance is the total repayable, nothing due, status DISBURSED', () => {
    const s = service({
      ...loan,
      paidRwf: 0,
      disbursedAt: D('2026-10-01'),
      now: D('2026-10-01'),
    });
    expect(s).toMatchObject({
      outstandingRwf: 45_840_000,
      arrearsRwf: 0,
      monthsDue: 0,
      status: 'DISBURSED',
    });
  });

  it('a driver who paid the instalment before day 30 is ACTIVE with no arrears', () => {
    const s = service({
      ...loan,
      paidRwf: 764_000,
      disbursedAt: D('2026-10-01'),
      now: D('2026-11-05'),
    });
    expect(s.status).toBe('ACTIVE');
    expect(s.arrearsRwf).toBe(0);
    expect(s.outstandingRwf).toBe(45_840_000 - 764_000);
  });

  it('partial payment: arrears is the shortfall, still under one instalment behind', () => {
    const s = service({
      ...loan,
      paidRwf: 500_000,
      disbursedAt: D('2026-10-01'),
      now: D('2026-11-05'),
    });
    expect(s.status).toBe('IN_ARREARS');
    expect(s.arrearsRwf).toBe(264_000);
    expect(s.instalmentsBehind).toBe(0);
  });

  it('two months in with nothing paid: two instalments behind', () => {
    const s = service({
      ...loan,
      paidRwf: 0,
      disbursedAt: D('2026-10-01'),
      now: D('2026-12-05'),
    });
    expect(s.arrearsRwf).toBe(1_528_000);
    expect(s.instalmentsBehind).toBe(2);
    expect(s.status).toBe('IN_ARREARS');
  });

  it('paying ahead never produces negative arrears, and clears the balance at the end', () => {
    const s = service({
      ...loan,
      paidRwf: 45_840_000,
      disbursedAt: D('2026-10-01'),
      now: D('2027-01-01'),
    });
    expect(s.arrearsRwf).toBe(0);
    expect(s.outstandingRwf).toBe(0);
    expect(s.status).toBe('ACTIVE');
  });

  it('expected-to-date is capped at the total repayable after the tenor', () => {
    const s = service({
      ...loan,
      paidRwf: 45_000_000,
      disbursedAt: D('2020-01-01'),
      now: D('2030-01-01'),
    });
    expect(s.arrearsRwf).toBe(840_000);
  });

  it('a closed loan has no arrears whatever the arithmetic says', () => {
    const s = service({
      ...loan,
      paidRwf: 0,
      disbursedAt: D('2026-10-01'),
      now: D('2027-06-01'),
      closedAt: D('2027-05-01'),
    });
    expect(s.status).toBe('CLOSED');
    expect(s.arrearsRwf).toBe(0);
  });

  it('refuses to service a loan that was never disbursed', () => {
    expect(() =>
      service({ ...loan, paidRwf: 0, disbursedAt: null, now: D('2026-10-01') }),
    ).toThrow();
  });
});

describe("normalising a bank's repayment file", () => {
  it('matches columns by name, whatever the bank called them', () => {
    const { ok, errors } = normaliseRepaymentRows([
      {
        'Loan Ref': 'LOAN-2026-000001',
        'Amount (RWF)': '764,000',
        'Value Date': '2026-11-03',
        Receipt: 'UNG-1',
      },
      {
        loan: 'LOAN-2026-000002',
        paid: 'RWF 300000',
        date: '2026-11-04',
        txn: 'UNG-2',
      },
    ]);
    expect(errors).toEqual([]);
    expect(ok).toHaveLength(2);
    expect(ok[0]).toMatchObject({
      loanRef: 'LOAN-2026-000001',
      amountRwf: 764_000,
      reference: 'UNG-1',
    });
    expect(ok[1].amountRwf).toBe(300_000);
  });

  it('reports a bad row with its line number instead of skipping it silently', () => {
    const { ok, errors } = normaliseRepaymentRows([
      {
        loan: 'LOAN-2026-000001',
        amount: 'abc',
        date: 'yesterday',
        reference: '',
      },
    ]);
    expect(ok).toEqual([]);
    expect(errors[0].row).toBe(2);
    expect(errors[0].problem).toMatch(/amount/);
    expect(errors[0].problem).toMatch(/date/);
    expect(errors[0].problem).toMatch(/reference/);
  });
});
