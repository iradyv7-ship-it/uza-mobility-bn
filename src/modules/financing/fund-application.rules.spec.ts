import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertSubmittable,
  consentCaptureFor,
  isBlockedAtIntake,
  screenApplication,
  type ScreenableApplication,
  type SubmittableApplication,
} from './fund-application.rules';

/**
 * The first cohort signs these forms tomorrow.
 *
 * Two things must hold. A form that is not finished or not signed must not be accepted —
 * because an unsigned application is not an application. And screening must produce a
 * list of things to CLOSE, never a verdict, because the premise of the programme is that
 * the applicant is undocumented rather than unbankable.
 */

const NOW = new Date('2026-09-11T08:00:00Z');
const REQUIRED = 1_600_000; // 10% of a 16.0M vehicle

const complete: SubmittableApplication = {
  fullName: 'A Driver',
  nationalId: '1199#############',
  phone: '+250#########',
  district: 'Nyarugenge',
  declarationAccepted: true,
  dataProcessingConsentGiven: true,
  signedAt: NOW,
  signatureRef: 'gridfs:sig-1',
};

const applicant: ScreenableApplication = {
  licenceNumber: 'RW-D-123456',
  licenceExpiry: new Date('2028-01-01'),
  nationalId: '1199#############',
  averageDailyTakingsRwf: 22_000,
  workingDaysPerWeek: 6,
  currentSavingsRwf: 400_000,
  hasBankAccount: false,
  hasBorrowedBefore: false,
  mobileMoneyNumber: '+250#########',
};

const kinds = (gaps: { kind: string }[]) => gaps.map((g) => g.kind).sort();

describe('a form that cannot be submitted', () => {
  it('names every missing field in words the applicant would recognise', () => {
    // This text is read aloud to somebody sitting at a table, not parsed by a developer.
    try {
      assertSubmittable({ ...complete, fullName: '', phone: '  ' });
      throw new Error('should have refused');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('full name');
      expect(msg).toContain('telephone number');
      expect(msg).not.toMatch(/fullName|phone:/);
    }
  });

  it('refuses without the truth declaration', () => {
    expect(() =>
      assertSubmittable({ ...complete, declarationAccepted: false }),
    ).toThrow(/answers given are true/);
  });

  it('refuses without data-processing consent, separately', () => {
    // Two different agreements. Bundling them into one tickbox is what makes a consent
    // unenforceable, so they are checked apart and both are required.
    expect(() =>
      assertSubmittable({ ...complete, dataProcessingConsentGiven: false }),
    ).toThrow(/keeping their training and vehicle record/);
  });

  it('refuses an unsigned form, and one signed with no signature on file', () => {
    expect(() => assertSubmittable({ ...complete, signedAt: null })).toThrow(
      /signed/,
    );
    expect(() => assertSubmittable({ ...complete, signatureRef: '' })).toThrow(
      /signed/,
    );
  });

  it('does NOT require lender consent to submit', () => {
    // An applicant may join the programme without yet agreeing that any particular bank
    // may read their file. Forcing that at the door would make it not a choice.
    expect(() => assertSubmittable(complete)).not.toThrow();
  });

  it('accepts a complete, signed form', () => {
    expect(() => assertSubmittable(complete)).not.toThrow();
    expect(() => assertSubmittable(complete)).not.toThrow(BadRequestException);
  });
});

describe('screening produces gaps, never a verdict', () => {
  it('finds the four gaps a typical first-cohort driver has', () => {
    const gaps = screenApplication(applicant, {
      requiredContributionRwf: REQUIRED,
      now: NOW,
    });
    expect(kinds(gaps)).toEqual([
      'CONTRIBUTION_SHORT',
      'NO_BANK_FARE_SETTLEMENT',
      'NO_VERIFIABLE_INCOME',
      'THIN_CREDIT_FILE',
    ]);
  });

  it('quantifies the contribution shortfall rather than just naming it', () => {
    // "You are short" is not actionable. "You are short RWF 1,200,000" is.
    const gap = screenApplication(applicant, {
      requiredContributionRwf: REQUIRED,
      now: NOW,
    }).find((g) => g.kind === 'CONTRIBUTION_SHORT');

    expect(gap?.shortfallRwf).toBe(1_200_000);
    expect(gap?.detail).toContain('1,200,000');
  });

  it('closes the contribution gap when savings reach the requirement', () => {
    const gaps = screenApplication(
      { ...applicant, currentSavingsRwf: REQUIRED },
      { requiredContributionRwf: REQUIRED, now: NOW },
    );
    expect(kinds(gaps)).not.toContain('CONTRIBUTION_SHORT');
  });

  it('records declared income as declared, and keeps the gap open', () => {
    // The gap this programme exists to close must not be closed by somebody's say-so.
    const gap = screenApplication(applicant, {
      requiredContributionRwf: REQUIRED,
      now: NOW,
    }).find((g) => g.kind === 'NO_VERIFIABLE_INCOME');

    expect(gap).toBeDefined();
    expect(gap?.detail).toMatch(/not yet verified/);
    expect(gap?.detail).toMatch(/90 days/);
  });

  it('says so differently when no income is declared at all', () => {
    const gap = screenApplication(
      { ...applicant, averageDailyTakingsRwf: 0 },
      { requiredContributionRwf: REQUIRED, now: NOW },
    ).find((g) => g.kind === 'NO_VERIFIABLE_INCOME');

    expect(gap?.detail).toBe('No income declared.');
  });

  it('treats mobile money as a lesser version of the settlement gap, not as nothing', () => {
    // A driver with MoMo history is materially closer to bankable than one dealing only
    // in cash, and the gap detail has to carry that or the distinction is lost.
    const withMomo = screenApplication(applicant, {
      requiredContributionRwf: REQUIRED,
      now: NOW,
    }).find((g) => g.kind === 'NO_BANK_FARE_SETTLEMENT');
    expect(withMomo?.detail).toMatch(/settlement trail exists/);

    const cashOnly = screenApplication(
      { ...applicant, mobileMoneyNumber: null },
      { requiredContributionRwf: REQUIRED, now: NOW },
    ).find((g) => g.kind === 'NO_BANK_FARE_SETTLEMENT');
    expect(cashOnly?.detail).toMatch(/cash only/);
  });

  it('drops the settlement gap once there is a bank account', () => {
    const gaps = screenApplication(
      { ...applicant, hasBankAccount: true },
      { requiredContributionRwf: REQUIRED, now: NOW },
    );
    expect(kinds(gaps)).not.toContain('NO_BANK_FARE_SETTLEMENT');
  });

  it('distinguishes an expired licence from no licence', () => {
    // Renewing is a smaller task than sitting a test, and the detail must say which.
    const expired = screenApplication(
      { ...applicant, licenceExpiry: new Date('2026-01-01') },
      { requiredContributionRwf: REQUIRED, now: NOW },
    ).find((g) => g.kind === 'LICENCE_OR_PERMIT');
    expect(expired?.detail).toMatch(/expired 2026-01-01/);
    expect(expired?.detail).toMatch(/Renewal required/);

    const none = screenApplication(
      { ...applicant, licenceNumber: '' },
      { requiredContributionRwf: REQUIRED, now: NOW },
    ).find((g) => g.kind === 'LICENCE_OR_PERMIT');
    expect(none?.detail).toMatch(/No driving licence/);
  });

  it('returns no gaps at all for someone already bankable', () => {
    // A meaningful, expected result — this is who the programme is trying to manufacture.
    const ready = screenApplication(
      {
        ...applicant,
        currentSavingsRwf: REQUIRED,
        hasBankAccount: true,
        hasBorrowedBefore: true,
      },
      { requiredContributionRwf: REQUIRED, now: NOW },
    ).filter((g) => g.kind !== 'NO_VERIFIABLE_INCOME');

    expect(ready).toEqual([]);
  });
});

describe('what actually stops somebody at the door', () => {
  it('does not block on the gaps the programme exists to close', () => {
    const gaps = screenApplication(applicant, {
      requiredContributionRwf: REQUIRED,
      now: NOW,
    });
    expect(isBlockedAtIntake(gaps)).toBe(false);
  });

  it('blocks on a missing licence', () => {
    const gaps = screenApplication(
      { ...applicant, licenceNumber: null },
      { requiredContributionRwf: REQUIRED, now: NOW },
    );
    expect(isBlockedAtIntake(gaps)).toBe(true);
  });

  it('blocks on missing identity documents', () => {
    const gaps = screenApplication(
      { ...applicant, nationalId: '' },
      { requiredContributionRwf: REQUIRED, now: NOW },
    );
    expect(isBlockedAtIntake(gaps)).toBe(true);
  });

  it('never blocks on being poor or unbanked', () => {
    // The whole premise. Somebody with nothing saved, no bank account and no credit file
    // is exactly the person this fund is for.
    const gaps = screenApplication(
      {
        ...applicant,
        currentSavingsRwf: 0,
        hasBankAccount: false,
        hasBorrowedBefore: false,
        mobileMoneyNumber: null,
      },
      { requiredContributionRwf: REQUIRED, now: NOW },
    );
    expect(isBlockedAtIntake(gaps)).toBe(false);
  });
});

describe('what a signature records as consent', () => {
  const base = {
    id: 'app-1',
    uzaId: null as string | null,
    lenderConsentGiven: true,
    preferredLenderKey: 'unguka',
    completionMode: 'ASSISTED' as string | null,
  };

  it('records consent for an applicant who has no UZA ID yet', () => {
    // THE REGRESSION. Capture used to be conditioned on `uzaId`, which no first-time
    // applicant has at intake — so every driver in the first cohort would have signed in
    // front of a witness and had nothing written down.
    const capture = consentCaptureFor(base);
    expect(capture).not.toBeNull();
    expect(capture?.fundApplicationId).toBe('app-1');
    expect(capture?.uzaId).toBeNull();
    expect(capture?.lenderKey).toBe('unguka');
  });

  it('carries the UZA ID through once there is one', () => {
    expect(
      consentCaptureFor({ ...base, uzaId: 'UZA-P-2026-000141' })?.uzaId,
    ).toBe('UZA-P-2026-000141');
  });

  it('records nothing when the box was not ticked', () => {
    expect(
      consentCaptureFor({ ...base, lenderConsentGiven: false }),
    ).toBeNull();
    expect(consentCaptureFor({ ...base, lenderConsentGiven: null })).toBeNull();
  });

  it('records nothing when no lender is named, because consent needs a recipient', () => {
    expect(consentCaptureFor({ ...base, preferredLenderKey: null })).toBeNull();
    expect(
      consentCaptureFor({ ...base, preferredLenderKey: '   ' }),
    ).toBeNull();
  });

  it('normalises the lender key so a portal cannot miss its own consents', () => {
    expect(
      consentCaptureFor({ ...base, preferredLenderKey: ' UNGUKA ' })?.lenderKey,
    ).toBe('unguka');
  });

  it('distinguishes a form read aloud by staff from one filled in alone', () => {
    // Under 058/2021 how consent was obtained is part of whether it holds.
    expect(consentCaptureFor(base)?.source).toBe('STAFF_RECORDED');
    expect(
      consentCaptureFor({ ...base, completionMode: 'SELF_SERVICE' })?.source,
    ).toBe('SIGNED_FORM');
  });
});
