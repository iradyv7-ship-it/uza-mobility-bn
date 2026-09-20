import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  commitment,
  PROVING_STREAK_DAYS,
  STAGE_ORDER,
  type CommitmentSignals,
} from './commitment.rules';

const none: CommitmentSignals = {
  emailVerified: false,
  phoneVerified: false,
  hasChosenVehicle: false,
  declaredIncome: false,
  attendedOrientation: false,
  walletOpened: false,
  confirmedDeposits: 0,
  currentStreak: 0,
  longestStreak: 0,
  documentsComplete: false,
  comprehensionPassed: false,
  contributionTotalRwf: 0,
  clientMinimumRwf: 1_500_000,
  fundApplicationSigned: false,
};
const interested: CommitmentSignals = { ...none, emailVerified: true, hasChosenVehicle: true, declaredIncome: true };
const showedUp: CommitmentSignals = { ...interested, attendedOrientation: true, walletOpened: true, confirmedDeposits: 1 };
const proving: CommitmentSignals = { ...showedUp, currentStreak: PROVING_STREAK_DAYS, documentsComplete: true, comprehensionPassed: true };
const ready: CommitmentSignals = { ...proving, contributionTotalRwf: 1_500_000, fundApplicationSigned: true };

describe('the commitment ladder', () => {
  it('a Google sign-in who did nothing is browsing, costs no staff time, and is told to verify contact', () => {
    const c = commitment(none);
    expect(c.stage).toBe('BROWSING');
    expect(c.staffTime).toBe('none');
    expect(c.next?.code).toBe('VERIFY_CONTACT');
  });

  it('verified + chose a car + declared income → interested; the next step is to come to orientation', () => {
    const c = commitment(interested);
    expect(c.stage).toBe('INTERESTED');
    expect(c.staffTime).toBe('automated');
    expect(c.next?.code).toBe('ATTEND_ORIENTATION');
  });

  it('attending without a first deposit is still interested — the deposit is the proof', () => {
    const c = commitment({ ...interested, attendedOrientation: true, walletOpened: true });
    expect(c.stage).toBe('INTERESTED');
    expect(c.next?.code).toBe('OPEN_WALLET_AND_DEPOSIT');
  });

  it('showed up: first staff conversation; next is the streak', () => {
    const c = commitment(showedUp);
    expect(c.stage).toBe('SHOWED_UP');
    expect(c.staffTime).toBe('first-conversation');
    expect(c.next?.code).toBe('KEEP_THE_STREAK');
  });

  it('a broken streak still counts if the longest reached the bar', () => {
    const c = commitment({ ...showedUp, currentStreak: 3, longestStreak: PROVING_STREAK_DAYS, documentsComplete: true, comprehensionPassed: true });
    expect(c.stage).toBe('PROVING');
  });

  it('proving: intake officer time; minimum, then signature', () => {
    expect(commitment(proving).next?.code).toBe('REACH_MINIMUM');
    expect(commitment({ ...proving, contributionTotalRwf: 2_000_000 }).next?.code).toBe('SIGN_APPLICATION');
    expect(commitment(proving).staffTime).toBe('intake-officer');
  });

  it('credits count toward the minimum exactly like savings', () => {
    const c = commitment({ ...proving, contributionTotalRwf: 1_500_000 });
    expect(c.next?.code).toBe('SIGN_APPLICATION');
  });

  it('ready: a lender’s time, nothing left to do', () => {
    const c = commitment(ready);
    expect(c.stage).toBe('READY');
    expect(c.next).toBeNull();
    expect(c.staffTime).toBe('lender');
    expect(c.evidence).toContain('Client minimum reached');
  });

  it('every next step is bilingual and every stage has a rung', () => {
    for (const s of [none, interested, showedUp, proving]) {
      const c = commitment(s);
      expect(c.next?.en.length).toBeGreaterThan(10);
      expect(c.next?.rw.length).toBeGreaterThan(10);
      expect(STAGE_ORDER[c.rung]).toBe(c.stage);
    }
  });

  it('property: adding evidence never lowers the rung', () => {
    const bool = fc.boolean();
    const arb = fc.record({
      emailVerified: bool, phoneVerified: bool, hasChosenVehicle: bool, declaredIncome: bool,
      attendedOrientation: bool, walletOpened: bool, confirmedDeposits: fc.nat(5),
      currentStreak: fc.nat(40), longestStreak: fc.nat(40), documentsComplete: bool,
      comprehensionPassed: bool, contributionTotalRwf: fc.nat(3_000_000),
      clientMinimumRwf: fc.constant(1_500_000), fundApplicationSigned: bool,
    });
    fc.assert(
      fc.property(arb, (s) => {
        const base = commitment(s).rung;
        const more: CommitmentSignals = {
          ...s,
          emailVerified: true, hasChosenVehicle: true, declaredIncome: true, attendedOrientation: true,
          walletOpened: true, confirmedDeposits: Math.max(1, s.confirmedDeposits),
          longestStreak: Math.max(s.longestStreak, s.currentStreak),
        };
        expect(commitment(more).rung).toBeGreaterThanOrEqual(base);
      }),
    );
  });
});
