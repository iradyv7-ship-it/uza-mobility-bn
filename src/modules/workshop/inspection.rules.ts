import { ForbiddenException } from '@nestjs/common';

/**
 * Who may file a monthly inspection, and what one contains.
 *
 * Pure functions, no database. These are the rules a lender is relying on when it accepts a
 * garage's monthly report as evidence about its collateral: that the person filing was
 * certified at the time, and that what they filed says what was wrong and what was done.
 *
 * ── The tenant wall ──────────────────────────────────────────────────────────────────────
 *
 * Two kinds of mechanic hold the same MECHANIC role. An EMPLOYED mechanic works in UZA's own
 * workshop and may see the board — job cards, the roster, rescue calls. A CERTIFIED mechanic
 * is an independent partner garage: UZA certifies their work and they file inspections
 * against vehicles brought to them, and that is ALL they may see. A partner garage reading
 * UZA's job-card board would be reading other garages' work and UZA's own capacity.
 *
 * `isInternalWorkshopStaff` is the one function that draws that line, and
 * `InternalWorkshopGuard` enforces it at the route with a 404, so an external garage
 * probing an internal route gets the same answer as a typo.
 */

export type MechanicEngagementKind = 'EMPLOYED' | 'CERTIFIED';

export interface CertifiableMechanic {
  engagement: MechanicEngagementKind;
  certifiedUntil: Date;
  suspendedAt: Date | null;
}

export function isInternalWorkshopStaff(
  roles: readonly string[] | undefined,
  mechanic: { engagement: MechanicEngagementKind } | null,
): boolean {
  if (roles?.includes('SUPER_ADMIN') || roles?.includes('WORKSHOP_ADMIN'))
    return true;
  return mechanic?.engagement === 'EMPLOYED';
}

/**
 * A mechanic may file only while certified and not suspended.
 *
 * Until 12 September 2026 neither field was consulted on write: a garage whose
 * certification had lapsed, or that had been suspended, could still file reports a bank
 * would read as current. The message names the reason because the caller is the garage
 * itself, not a third party — there is nothing to hide from them about their own status.
 */
export function assertMayFileInspection(
  mechanic: CertifiableMechanic,
  now: Date = new Date(),
): void {
  if (mechanic.suspendedAt) {
    throw new ForbiddenException(
      'This garage is suspended and may not file inspections. Contact UZA.',
    );
  }
  if (mechanic.certifiedUntil.getTime() < now.getTime()) {
    throw new ForbiddenException(
      `This garage's certification expired on ${mechanic.certifiedUntil.toISOString().slice(0, 10)}. Renew before filing.`,
    );
  }
}

/** One thing found on the vehicle, and what was done about it. */
export interface InspectionFinding {
  item: string;
  severity: 'MINOR' | 'MAJOR' | 'SAFETY';
  correctiveAction: string;
  resolvedAt?: string | null;
}

/**
 * An inspection that certifies the vehicle passed must not carry an unresolved SAFETY
 * finding. A garage can record a failed inspection with open findings — that is exactly the
 * honest report a lender wants — but "passed" with an open brake defect is a contradiction
 * that must not reach a bank file.
 */
export function assertFindingsConsistent(
  passed: boolean | null | undefined,
  findings: readonly InspectionFinding[] | undefined,
): void {
  if (!passed || !findings?.length) return;
  const openSafety = findings.filter(
    (f) => f.severity === 'SAFETY' && !f.resolvedAt,
  );
  if (openSafety.length) {
    throw new ForbiddenException(
      `Cannot certify as passed with an unresolved safety finding: ${openSafety
        .map((f) => f.item)
        .join(', ')}.`,
    );
  }
}

/** The next monthly inspection falls due 30 days after this one unless the garage says otherwise. */
export function defaultNextDue(inspectedAt: Date): Date {
  return new Date(inspectedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
}
