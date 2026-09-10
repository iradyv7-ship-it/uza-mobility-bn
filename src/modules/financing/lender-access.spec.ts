import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  actsForLender,
  assertActsForLender,
  COLLATERAL_ENTITLED,
  LENDER_REFUSAL,
  lenderRoleFor,
  mayDisclose,
  maySeeCollateral,
  normaliseLenderKey,
  redactForLender,
} from './lender-access';

/**
 * The rules that carry the confidentiality commitments.
 *
 * Every test here corresponds to a promise made to a bank or a borrower. If one fails,
 * something was promised and is no longer true — which is why they are asserted here,
 * away from the database, where they can be read in one sitting.
 */

const LENDERS = ['unguka', 'ncba', 'equity'];

describe('acting for a lender', () => {
  it('opens a portal to the lender whose role the caller holds', () => {
    for (const key of LENDERS) {
      expect(actsForLender(key, [lenderRoleFor(key)])).toBe(true);
    }
  });

  it('refuses every cross-pair', () => {
    for (const a of LENDERS) {
      for (const b of LENDERS) {
        if (a === b) continue;
        expect(actsForLender(b, [lenderRoleFor(a)])).toBe(false);
      }
    }
  });

  it('derives the role from the key so the two cannot drift apart', () => {
    expect(lenderRoleFor('ncba')).toBe('LENDER_NCBA');
    expect(lenderRoleFor('  Unguka  ')).toBe('LENDER_UNGUKA');
  });

  it('normalises case and whitespace on the key', () => {
    expect(normaliseLenderKey('  NCBA ')).toBe('ncba');
    expect(actsForLender(' NCBA ', ['LENDER_NCBA'])).toBe(true);
  });

  it('lets SUPER_ADMIN in, because somebody must be able to see a broken portal', () => {
    expect(actsForLender('ncba', ['SUPER_ADMIN'])).toBe(true);
  });

  it('does NOT let other staff roles wander into a bank', () => {
    // "They are staff" is not consent under 058/2021.
    for (const role of [
      'MARKETPLACE_ADMIN',
      'FINANCE_ADMIN',
      'FLEET_ADMIN',
      'SELLER',
    ]) {
      expect(actsForLender('ncba', [role])).toBe(false);
    }
  });

  it('refuses somebody with no roles at all', () => {
    expect(actsForLender('ncba', [])).toBe(false);
    expect(actsForLender('ncba')).toBe(false);
  });

  it('throws the shared refusal, never a specific one', () => {
    expect(() => assertActsForLender('ncba', ['LENDER_UNGUKA'])).toThrow(
      ForbiddenException,
    );
    expect(() => assertActsForLender('ncba', ['LENDER_UNGUKA'])).toThrow(
      LENDER_REFUSAL,
    );
  });
});

describe('the disclosure gate', () => {
  const consented = {
    borrowerExists: true,
    isBorrowerOfThisLender: true,
    consentGivenAt: new Date('2026-08-01'),
    consentWithdrawnAt: null,
  };

  it('allows a consenting borrower of this lender', () => {
    expect(mayDisclose(consented)).toEqual({ allowed: true });
  });

  it('refuses a borrower who never consented', () => {
    // Entitled but not consented is still a refusal. Being the lender of record does not
    // create permission to read the file.
    expect(mayDisclose({ ...consented, consentGivenAt: null })).toEqual({
      allowed: false,
      reason: 'no-consent',
    });
  });

  it('refuses once consent is withdrawn, even though it was once given', () => {
    expect(
      mayDisclose({ ...consented, consentWithdrawnAt: new Date('2026-09-01') }),
    ).toEqual({ allowed: false, reason: 'consent-withdrawn' });
  });

  it('refuses another lender’s borrower', () => {
    expect(
      mayDisclose({ ...consented, isBorrowerOfThisLender: false }),
    ).toEqual({
      allowed: false,
      reason: 'not-this-lenders-borrower',
    });
  });

  it('refuses a reference that matches nobody', () => {
    expect(
      mayDisclose({
        ...consented,
        borrowerExists: false,
        isBorrowerOfThisLender: false,
      }),
    ).toEqual({ allowed: false, reason: 'no-such-borrower' });
  });

  it('distinguishes reasons for the LOG while the caller learns nothing', () => {
    // A lender repeatedly asking about people who are not its borrowers is a different
    // thing to notice than one asking about a borrower who withdrew consent. The log can
    // tell them apart; the lender cannot, because every refusal returns LENDER_REFUSAL.
    const reasons = [
      mayDisclose({ ...consented, borrowerExists: false }).reason,
      mayDisclose({ ...consented, isBorrowerOfThisLender: false }).reason,
      mayDisclose({ ...consented, consentGivenAt: null }).reason,
      mayDisclose({ ...consented, consentWithdrawnAt: new Date() }).reason,
    ];
    expect(new Set(reasons).size).toBe(4);
  });
});

describe('the cash-collateral facility', () => {
  it('is entitled to Unguka and to nobody else', () => {
    // The one thing onboarding must never grant by default. NCBA in particular must not
    // be added: they lend at 18% without collateral precisely because the proposition is
    // data. Adding them would consume the capital AND disclose a facility to a lender
    // who is not party to it.
    expect(COLLATERAL_ENTITLED).toEqual(['unguka']);
    expect(maySeeCollateral('unguka')).toBe(true);
    expect(maySeeCollateral('ncba')).toBe(false);
    expect(maySeeCollateral('equity')).toBe(false);
  });

  it('matches the entitlement case-insensitively', () => {
    expect(maySeeCollateral('  UNGUKA ')).toBe(true);
  });

  it('is REMOVED from an unentitled lender’s payload, not merely hidden', () => {
    const file = {
      uzaId: 'UZA-P-2026-000141',
      creditEnhancement: {
        pledgedRwf: 1_000_000,
        releasedRwf: 0,
        calledBackRwf: 0,
      },
    };

    const forNcba = redactForLender(file, 'ncba');
    expect(forNcba.creditEnhancement).toBeUndefined();
    expect('creditEnhancement' in forNcba).toBe(false);

    const forUnguka = redactForLender(file, 'unguka');
    expect(forUnguka.creditEnhancement).toEqual(file.creditEnhancement);
  });

  it('does not mutate the file it was given', () => {
    // The same composed file may be served to two lenders in one request cycle. If
    // redaction mutated it, the second would silently lose data — or the first would
    // keep it.
    const file = {
      uzaId: 'UZA-P-2026-000141',
      creditEnhancement: {
        pledgedRwf: 1_000_000,
        releasedRwf: 0,
        calledBackRwf: 0,
      },
    };
    redactForLender(file, 'ncba');
    expect(file.creditEnhancement).toBeDefined();
  });

  it('leaves everything else untouched', () => {
    const file = {
      uzaId: 'UZA-P-2026-000141',
      displayName: 'A Borrower',
      loan: { reference: 'L-1', outstandingRwf: 5_000_000 },
      creditEnhancement: { pledgedRwf: 1, releasedRwf: 0, calledBackRwf: 0 },
    };
    const out = redactForLender(file, 'ncba');
    expect(out.uzaId).toBe(file.uzaId);
    expect(out.displayName).toBe(file.displayName);
    expect(out.loan).toEqual(file.loan);
  });
});

describe('the refusal message', () => {
  it('is defined once so no portal can invent a more helpful one', () => {
    expect(LENDER_REFUSAL).toBe('No record available for that reference.');
  });

  it('says nothing about which rule failed', () => {
    for (const leak of [
      'consent',
      'borrower',
      'lender',
      'exist',
      'permission',
      'role',
    ]) {
      expect(LENDER_REFUSAL.toLowerCase()).not.toContain(leak);
    }
  });
});
