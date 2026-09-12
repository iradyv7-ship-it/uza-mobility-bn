import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertFindingsConsistent,
  assertMayFileInspection,
  defaultNextDue,
  isInternalWorkshopStaff,
} from './inspection.rules';

const NOW = new Date('2026-09-12T09:00:00Z');

describe('the tenant wall between UZA workshop and partner garages', () => {
  it('lets an employed mechanic onto the internal board', () => {
    expect(
      isInternalWorkshopStaff(['MECHANIC'], { engagement: 'EMPLOYED' }),
    ).toBe(true);
  });

  it('keeps a certified partner garage off it', () => {
    // Same MECHANIC role, different tenant. A partner garage reading UZA's job cards would
    // be reading other garages' work.
    expect(
      isInternalWorkshopStaff(['MECHANIC'], { engagement: 'CERTIFIED' }),
    ).toBe(false);
  });

  it('keeps a mechanic account with no Mechanic row off it', () => {
    expect(isInternalWorkshopStaff(['MECHANIC'], null)).toBe(false);
  });

  it('lets WORKSHOP_ADMIN and SUPER_ADMIN through regardless', () => {
    expect(isInternalWorkshopStaff(['WORKSHOP_ADMIN'], null)).toBe(true);
    expect(
      isInternalWorkshopStaff(['SUPER_ADMIN'], { engagement: 'CERTIFIED' }),
    ).toBe(true);
  });
});

describe('who may file an inspection', () => {
  const current = {
    engagement: 'CERTIFIED' as const,
    certifiedUntil: new Date('2027-01-01'),
    suspendedAt: null,
  };

  it('accepts a certified, unsuspended garage', () => {
    expect(() => assertMayFileInspection(current, NOW)).not.toThrow();
  });

  it('refuses an expired certification, and says when it expired', () => {
    // Before 12 Sep 2026 this was not checked: a lapsed garage could file reports a bank
    // would read as current.
    expect(() =>
      assertMayFileInspection(
        { ...current, certifiedUntil: new Date('2026-06-30') },
        NOW,
      ),
    ).toThrow(/expired on 2026-06-30/);
  });

  it('refuses a suspended garage even if its certification is in date', () => {
    expect(() =>
      assertMayFileInspection(
        { ...current, suspendedAt: new Date('2026-09-01') },
        NOW,
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('what an inspection may claim', () => {
  it('will not certify "passed" over an unresolved safety finding', () => {
    expect(() =>
      assertFindingsConsistent(true, [
        {
          item: 'Front brake pads below limit',
          severity: 'SAFETY',
          correctiveAction: 'Replace',
          resolvedAt: null,
        },
      ]),
    ).toThrow(/unresolved safety finding: Front brake pads below limit/);
  });

  it('allows "passed" once the safety finding is resolved', () => {
    expect(() =>
      assertFindingsConsistent(true, [
        {
          item: 'Front brake pads below limit',
          severity: 'SAFETY',
          correctiveAction: 'Replaced',
          resolvedAt: '2026-09-12',
        },
      ]),
    ).not.toThrow();
  });

  it('allows a failed inspection with open findings — the honest report', () => {
    expect(() =>
      assertFindingsConsistent(false, [
        {
          item: 'Coolant leak',
          severity: 'MAJOR',
          correctiveAction: 'Booked for repair',
        },
      ]),
    ).not.toThrow();
  });

  it('allows "passed" with only minor or major open findings', () => {
    expect(() =>
      assertFindingsConsistent(true, [
        {
          item: 'Scuffed rear bumper',
          severity: 'MINOR',
          correctiveAction: 'Cosmetic, noted',
        },
      ]),
    ).not.toThrow();
  });

  it('defaults the next inspection to thirty days on', () => {
    expect(defaultNextDue(NOW).toISOString().slice(0, 10)).toBe('2026-10-12');
  });
});
