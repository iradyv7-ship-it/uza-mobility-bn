import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertComfortLetterAllowed,
  assertDecisionAllowed,
  loanStatusForDecision,
} from './lender-decision.rules';

/**
 * `Loan.status` used to be the entire decision: one enum field, flipped straight to
 * APPROVED or DECLINED, with no reasons and no way back if it was wrong. These rules are
 * what stands between that and a decision a bank can actually be held to.
 */

describe('whether a decision may be recorded at all', () => {
  it('allows a decision while the loan is pending or in review', () => {
    for (const status of ['PENDING', 'IN_REVIEW'] as const) {
      expect(() =>
        assertDecisionAllowed(status, { outcome: 'APPROVED' }),
      ).not.toThrow();
    }
  });

  it('refuses a decision once the loan has already moved on', () => {
    for (const status of [
      'APPROVED',
      'DECLINED',
      'DISBURSED',
      'ACTIVE',
      'IN_ARREARS',
      'CLOSED',
    ] as const) {
      expect(() =>
        assertDecisionAllowed(status, { outcome: 'APPROVED' }),
      ).toThrow(BadRequestException);
    }
  });

  it('names the loan’s actual status in the refusal, not a generic message', () => {
    try {
      assertDecisionAllowed('DISBURSED', { outcome: 'REJECTED' });
      throw new Error('should have refused');
    } catch (e) {
      expect((e as Error).message).toContain('DISBURSED');
    }
  });

  it('refuses a CONDITIONAL decision with no conditions written down', () => {
    expect(() =>
      assertDecisionAllowed('PENDING', { outcome: 'CONDITIONAL' }),
    ).toThrow(/conditions is required/);
    expect(() =>
      assertDecisionAllowed('PENDING', {
        outcome: 'CONDITIONAL',
        conditions: '   ',
      }),
    ).toThrow(/conditions is required/);
  });

  it('accepts a CONDITIONAL decision once conditions are actually stated', () => {
    expect(() =>
      assertDecisionAllowed('IN_REVIEW', {
        outcome: 'CONDITIONAL',
        conditions: 'Provide a stamped bank statement for the last 3 months.',
      }),
    ).not.toThrow();
  });

  it('never requires conditions for APPROVED or REJECTED', () => {
    expect(() =>
      assertDecisionAllowed('PENDING', { outcome: 'APPROVED' }),
    ).not.toThrow();
    expect(() =>
      assertDecisionAllowed('PENDING', { outcome: 'REJECTED' }),
    ).not.toThrow();
  });
});

describe('what a decision does to Loan.status', () => {
  it('moves an approval to APPROVED', () => {
    expect(loanStatusForDecision('APPROVED')).toBe('APPROVED');
  });

  it('moves a rejection to DECLINED, not REJECTED — Loan has no REJECTED state', () => {
    expect(loanStatusForDecision('REJECTED')).toBe('DECLINED');
  });

  it('leaves the loan status untouched on a conditional approval', () => {
    // A conditional approval is not yet a disbursement decision — the loan stays
    // IN_REVIEW until an unconditional decision is recorded.
    expect(loanStatusForDecision('CONDITIONAL')).toBeNull();
  });
});

describe('whether a comfort letter may be uploaded', () => {
  it('refuses one before a decision has even been recorded', () => {
    for (const status of ['PENDING', 'IN_REVIEW'] as const) {
      expect(() => assertComfortLetterAllowed(status)).toThrow(
        BadRequestException,
      );
    }
  });

  it('refuses one once the bank has declined the loan', () => {
    expect(() => assertComfortLetterAllowed('DECLINED')).toThrow(
      /needs a recorded APPROVED decision/,
    );
  });

  it('allows one from APPROVED onward, including after disbursement and closure', () => {
    for (const status of [
      'APPROVED',
      'DISBURSED',
      'ACTIVE',
      'IN_ARREARS',
      'CLOSED',
    ] as const) {
      expect(() => assertComfortLetterAllowed(status)).not.toThrow();
    }
  });
});
