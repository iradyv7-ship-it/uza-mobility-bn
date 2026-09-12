import { ForbiddenException } from '@nestjs/common';

/**
 * Who a lender is, what it may see, and how it is refused.
 *
 * Kept as pure functions with no database and no Nest dependencies, because these are the
 * rules that carry the confidentiality commitments and they must be readable and testable
 * on their own. Everything that touches Prisma lives in `lender.service.ts`.
 *
 * ── THE FOUR RULES ────────────────────────────────────────────────────────────────────
 *
 *   1. A lender sees ITS OWN borrowers. Not the book, not another lender's borrowers, and
 *      not the fact that another lender exists.
 *
 *   2. Nothing is disclosed without the borrower's consent to THAT lender. Consent under
 *      Law N° 058/2021 is specific: agreeing that Unguka may see a file is not agreeing
 *      that NCBA may.
 *
 *   3. Every refusal is IDENTICAL, whichever rule failed. If "not your borrower" were
 *      distinguishable from "no such person", a lender could walk UZA IDs and learn who
 *      banks with UZA — a disclosure even when the answer is no.
 *
 *   4. The cash-collateral facility is visible to entitled lenders only, and it is REMOVED
 *      from the payload rather than merely hidden in the UI.
 *
 * This mirrors `uza-nexus/apps/api/src/platform/lender-view/lender-view-access.ts`. Two
 * systems, one contract — if one changes, the other has to.
 */

/**
 * Lenders entitled to see the credit-enhancement (cash-collateral) position.
 *
 * Deliberately a list of one. Onboarding a lender is routine and should be data; granting
 * one sight of this facility is a founder's decision, and it should cost a file change, a
 * test change, and somebody reviewing both.
 *
 * NCBA is NOT on this list and must not be added as a sweetener: they lend at 18% without
 * collateral precisely because the proposition is data. See `13-the-data-proposition.md`.
 */
export const COLLATERAL_ENTITLED: readonly string[] = ['unguka'];

/**
 * The one sentence a lender is ever told when it may not see something.
 *
 * Defined once so no controller can invent a more helpful variant. A "helpful" error
 * leaks which rule failed, which is how a portal starts answering whether a given person
 * is a UZA client.
 */
export const LENDER_REFUSAL = 'No record available for that reference.';

export const normaliseLenderKey = (key: string): string =>
  key.trim().toLowerCase();

/** The database role that opens a given lender's portal. Convention, not configuration. */
export const lenderRoleFor = (key: string): string =>
  `LENDER_${normaliseLenderKey(key).toUpperCase()}`;

/**
 * May this caller act for this lender?
 *
 * SUPER_ADMIN is included because somebody has to be able to see that a portal is broken —
 * on the API. The customer front end deliberately does NOT route a SUPER_ADMIN into any
 * bank's view (a person holding every key should not be dropped into one bank's book), so
 * for a browser check use a real per-lender account; for a raw check use this API directly.
 * No other staff role is included: a marketplace administrator has no business inside a
 * bank's borrower files, and "they are staff" is not consent under 058/2021.
 */
export function actsForLender(
  lenderKey: string,
  roles: readonly string[] = [],
): boolean {
  return (
    roles.includes(lenderRoleFor(lenderKey)) || roles.includes('SUPER_ADMIN')
  );
}

export function assertActsForLender(
  lenderKey: string,
  roles: readonly string[] = [],
): void {
  if (!actsForLender(lenderKey, roles))
    throw new ForbiddenException(LENDER_REFUSAL);
}

/** Is this lender party to the cash-collateral facility at all? */
export function maySeeCollateral(lenderKey: string): boolean {
  return COLLATERAL_ENTITLED.includes(normaliseLenderKey(lenderKey));
}

/** Why a disclosure was refused. Recorded in the audit log; never returned to the caller. */
export type RefusalReason =
  | 'no-such-borrower'
  | 'not-this-lenders-borrower'
  | 'no-consent'
  | 'consent-withdrawn';

export interface DisclosureInput {
  borrowerExists: boolean;
  /** Does this borrower hold a loan or application with THIS lender? */
  isBorrowerOfThisLender: boolean;
  consentGivenAt: Date | null;
  consentWithdrawnAt: Date | null;
}

export interface DisclosureDecision {
  allowed: boolean;
  reason?: RefusalReason;
}

/**
 * The gate, in the order the reasons matter for the audit log.
 *
 * The ORDER is deliberate even though the caller never learns it: a lender repeatedly
 * asking about people who are not its borrowers is a different thing to notice than one
 * asking about a borrower who withdrew consent, and the log should be able to tell them
 * apart even though the lender cannot.
 */
export function mayDisclose(input: DisclosureInput): DisclosureDecision {
  if (!input.borrowerExists)
    return { allowed: false, reason: 'no-such-borrower' };
  if (!input.isBorrowerOfThisLender) {
    return { allowed: false, reason: 'not-this-lenders-borrower' };
  }
  if (!input.consentGivenAt) return { allowed: false, reason: 'no-consent' };
  if (input.consentWithdrawnAt)
    return { allowed: false, reason: 'consent-withdrawn' };
  return { allowed: true };
}

/**
 * The cash-collateral position. Optional on purpose — see `redactForLender`.
 */
export interface CreditEnhancementBlock {
  pledgedRwf: number;
  releasedRwf: number;
  calledBackRwf: number;
}

/**
 * Everything a lender can be shown about one borrower, before redaction.
 *
 * NO DIRECT IDENTIFIERS. No national ID, no phone, no email, no address, no MoMo
 * reference. A lender gets a UZA ID and a display name. That is not an oversight to be
 * corrected later; it is the shape of the commitment.
 */
export interface LenderFacingFile {
  uzaId: string;
  displayName: string;

  loan?: {
    reference: string;
    principalRwf: number;
    tenorMonths: number;
    outstandingRwf: number;
    arrearsRwf: number;
    status: string;
    disbursedAt: string | null;
  };

  creditEnhancement?: CreditEnhancementBlock;
}

/**
 * Strip everything this lender may not see.
 *
 * Written as REMOVE-from-a-copy rather than build-up-a-copy on purpose. A build-up
 * function silently drops any field added to the interface later — which fails safe for
 * disclosure but produces a lender view that quietly loses data nobody notices. A remove
 * function fails the other way, so the one field where that would be unacceptable is
 * deleted explicitly and covered by a test that names it.
 */
export function redactForLender<
  T extends { creditEnhancement?: CreditEnhancementBlock },
>(file: T, lenderKey: string): T {
  const out = { ...file };
  if (!maySeeCollateral(lenderKey)) delete out.creditEnhancement;
  return out;
}
