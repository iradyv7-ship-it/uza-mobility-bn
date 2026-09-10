import { BadRequestException } from '@nestjs/common';

/**
 * What a completed application means, decided from the answers rather than from opinion.
 *
 * Two jobs, kept apart on purpose:
 *
 *   `assertSubmittable` — is this form finished and signed? A question of completeness.
 *   `screenApplication` — what stands between this applicant and a loan? A question of
 *                          eligibility, and the answer is a list of gaps to close, never
 *                          a yes or a no.
 *
 * ── WHY GAPS AND NOT A SCORE ──────────────────────────────────────────────────────────
 *
 * A score tells a driver they failed. A gap list tells them what to do next, and that is
 * the whole premise of UZA Empower: the applicant is not unbankable, they are
 * *undocumented*, and each gap is a thing that can be closed. `ADVISED_TO_BUILD_FURTHER`
 * is a real outcome in `JourneyStage`, not a rejection.
 *
 * Nothing here decides to lend. It decides what is missing.
 */

export type GapKind =
  | 'CONTRIBUTION_SHORT'
  | 'NO_BANK_FARE_SETTLEMENT'
  | 'NO_VERIFIABLE_INCOME'
  | 'THIN_CREDIT_FILE'
  | 'DOCUMENTS_INCOMPLETE'
  | 'LICENCE_OR_PERMIT';

export interface ScreeningGap {
  kind: GapKind;
  detail: string;
  /** Set where the gap is an amount of money. Whole RWF. */
  shortfallRwf?: number;
}

/** Only the fields screening reads. Keeps this testable without the Prisma model. */
export interface ScreenableApplication {
  licenceNumber?: string | null;
  licenceExpiry?: Date | null;
  nationalId?: string | null;
  averageDailyTakingsRwf?: number | null;
  workingDaysPerWeek?: number | null;
  currentSavingsRwf?: number | null;
  hasBankAccount?: boolean | null;
  hasBorrowedBefore?: boolean | null;
  mobileMoneyNumber?: string | null;
}

export interface ScreeningContext {
  /** The contribution this lender's product requires, in whole RWF. */
  requiredContributionRwf: number;
  /** Date screening is performed. Injected so tests are not time-dependent. */
  now?: Date;
}

/**
 * The gaps between this applicant and a loan.
 *
 * Returns an empty list when nothing is missing — which is a meaningful and expected
 * result, not an error. An applicant with no gaps is exactly who this programme is trying
 * to manufacture.
 */
export function screenApplication(
  app: ScreenableApplication,
  ctx: ScreeningContext,
): ScreeningGap[] {
  const now = ctx.now ?? new Date();
  const gaps: ScreeningGap[] = [];

  // --- Licence ------------------------------------------------------------------
  if (!app.licenceNumber?.trim()) {
    gaps.push({
      kind: 'LICENCE_OR_PERMIT',
      detail: 'No driving licence number recorded.',
    });
  } else if (app.licenceExpiry && app.licenceExpiry <= now) {
    // An expired licence is not the same as none: the driver has held one, and renewing
    // is a smaller task than sitting a test. The detail says so.
    gaps.push({
      kind: 'LICENCE_OR_PERMIT',
      detail: `Licence expired ${app.licenceExpiry.toISOString().slice(0, 10)}. Renewal required.`,
    });
  }

  // --- Identity documents --------------------------------------------------------
  if (!app.nationalId?.trim()) {
    gaps.push({
      kind: 'DOCUMENTS_INCOMPLETE',
      detail: 'National ID not recorded.',
    });
  }

  // --- Income --------------------------------------------------------------------
  //
  // Declared income is NOT verified income, and this gap stays open until the wallet has
  // a record. Closing it on the strength of what somebody said is how a programme built
  // to produce verifiable income ends up producing the same unverified claim as before.
  const declaresIncome =
    (app.averageDailyTakingsRwf ?? 0) > 0 && (app.workingDaysPerWeek ?? 0) > 0;
  gaps.push({
    kind: 'NO_VERIFIABLE_INCOME',
    detail: declaresIncome
      ? 'Income declared but not yet verified. Closes after 90 days of wallet record.'
      : 'No income declared.',
  });

  // --- Contribution ---------------------------------------------------------------
  const savings = app.currentSavingsRwf ?? 0;
  if (savings < ctx.requiredContributionRwf) {
    gaps.push({
      kind: 'CONTRIBUTION_SHORT',
      // Names the shortfall rather than the two numbers it comes from. "You are short
      // RWF 1,200,000" is something a driver can act on; making them subtract is not.
      detail:
        `Short by RWF ${(ctx.requiredContributionRwf - savings).toLocaleString('en-RW')}. ` +
        `Saved RWF ${savings.toLocaleString('en-RW')} of the RWF ${ctx.requiredContributionRwf.toLocaleString('en-RW')} required.`,
      shortfallRwf: ctx.requiredContributionRwf - savings,
    });
  }

  // --- Where fares land ------------------------------------------------------------
  //
  // Mobile money is not a bank account, but it is a settlement trail — so it is recorded
  // as a lesser version of the same gap rather than being ignored. A driver with MoMo
  // history is materially closer to bankable than one dealing only in cash.
  if (!app.hasBankAccount) {
    gaps.push({
      kind: 'NO_BANK_FARE_SETTLEMENT',
      detail: app.mobileMoneyNumber?.trim()
        ? 'No bank account. Mobile money in use — a settlement trail exists.'
        : 'No bank account and no mobile money record. Fares are cash only.',
    });
  }

  // --- Credit history ---------------------------------------------------------------
  if (!app.hasBorrowedBefore) {
    gaps.push({
      kind: 'THIN_CREDIT_FILE',
      detail: 'No prior borrowing to underwrite against.',
    });
  }

  return gaps;
}

/** Only the fields completeness reads. */
export interface SubmittableApplication {
  fullName?: string | null;
  nationalId?: string | null;
  phone?: string | null;
  district?: string | null;
  declarationAccepted?: boolean | null;
  dataProcessingConsentGiven?: boolean | null;
  signedAt?: Date | null;
  signatureRef?: string | null;
}

/**
 * Refuse to submit a form that is not finished or not signed.
 *
 * Every message names the field in words an applicant would recognise, because this text
 * is read aloud to somebody sitting at a table — not parsed by a developer.
 *
 * The declaration and the data-processing consent are checked SEPARATELY and both are
 * required. They are different agreements: one says the answers are true, the other
 * permits UZA to keep and process the record. Bundling them into a single tickbox is the
 * thing that makes a consent unenforceable.
 *
 * Lender consent is deliberately NOT required here. An applicant may join the programme
 * without yet agreeing that any particular bank may read their file, and forcing that
 * choice at the door would make it not a choice.
 */
export function assertSubmittable(app: SubmittableApplication): void {
  const missing: string[] = [];

  if (!app.fullName?.trim()) missing.push('full name');
  if (!app.nationalId?.trim()) missing.push('national ID number');
  if (!app.phone?.trim()) missing.push('telephone number');
  if (!app.district?.trim()) missing.push('district');

  if (missing.length > 0) {
    throw new BadRequestException(
      `This application is not complete. Still needed: ${missing.join(', ')}.`,
    );
  }

  if (!app.declarationAccepted) {
    throw new BadRequestException(
      'The applicant must confirm that the answers given are true before the form can be submitted.',
    );
  }

  if (!app.dataProcessingConsentGiven) {
    throw new BadRequestException(
      'The applicant must agree to UZA keeping their training and vehicle record before the form can be submitted.',
    );
  }

  if (!app.signedAt || !app.signatureRef?.trim()) {
    throw new BadRequestException(
      'The application must be signed before it can be submitted.',
    );
  }
}

/**
 * Whether the gaps found leave a path forward.
 *
 * `NO_VERIFIABLE_INCOME` is present on essentially every application at intake — that is
 * what the programme exists to close — so it never on its own means "no". Only a missing
 * licence or missing identity documents stop somebody at the door, and even those are
 * stated as "not yet" rather than "no".
 */
export function isBlockedAtIntake(gaps: readonly ScreeningGap[]): boolean {
  return gaps.some(
    (g) => g.kind === 'LICENCE_OR_PERMIT' || g.kind === 'DOCUMENTS_INCOMPLETE',
  );
}

/**
 * What a signature should record as consent, if anything.
 *
 * Extracted from the service so it can be asserted without a database. The bug it guards
 * against is specific and was live: consent capture was conditioned on the applicant
 * having a UZA ID, which no first-time applicant has at intake. Every driver in the first
 * cohort would have ticked the box, signed in front of a witness, and had nothing
 * recorded. A missing UZA ID must never suppress the capture — it only leaves the row
 * unreconciled until one is issued.
 */
export interface ConsentCapture {
  fundApplicationId: string;
  uzaId: string | null;
  lenderKey: string;
  source: 'STAFF_RECORDED' | 'SIGNED_FORM';
}

export function consentCaptureFor(app: {
  id: string;
  uzaId: string | null;
  lenderConsentGiven: boolean | null;
  preferredLenderKey: string | null;
  completionMode: string | null;
}): ConsentCapture | null {
  if (!app.lenderConsentGiven) return null;

  // No lender named is not the same as consent withheld, but there is nothing to consent
  // TO, so nothing is written. The tickbox alone does not identify a recipient.
  const lenderKey = app.preferredLenderKey?.trim().toLowerCase();
  if (!lenderKey) return null;

  return {
    fundApplicationId: app.id,
    uzaId: app.uzaId,
    lenderKey,
    source:
      app.completionMode === 'ASSISTED' ? 'STAFF_RECORDED' : 'SIGNED_FORM',
  };
}
