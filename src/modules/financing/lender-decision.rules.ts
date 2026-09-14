import { BadRequestException } from '@nestjs/common';
import type { LenderDecisionOutcome, LoanStatus } from '@prisma/client';

/**
 * The business rules behind recording a bank's credit decision, kept as pure functions
 * with no Prisma and no Nest `ExecutionContext` — same reasoning `lender-access.ts` and
 * `loan-terms.ts` give for their own existence: these rules are what makes the structured
 * decision trail trustworthy, and they need to be readable and testable on their own,
 * away from a database. `LenderService.recordDecision` is the only caller.
 */

const DECIDABLE_STATUSES: readonly LoanStatus[] = ['PENDING', 'IN_REVIEW'];

export interface DecisionInput {
  outcome: LenderDecisionOutcome;
  conditions?: string | null;
}

/**
 * Refuses to record a decision on a loan that has already moved past the point of being
 * decided (already approved, declined, disbursed, …), and refuses a CONDITIONAL decision
 * with no stated conditions — a conditional approval with nothing written down is not
 * actually conditional on anything.
 */
export function assertDecisionAllowed(
  loanStatus: LoanStatus,
  input: DecisionInput,
): void {
  if (!DECIDABLE_STATUSES.includes(loanStatus)) {
    throw new BadRequestException(
      `Cannot record a decision when the loan is already ${loanStatus}`,
    );
  }

  if (input.outcome === 'CONDITIONAL' && !input.conditions?.trim()) {
    throw new BadRequestException(
      'conditions is required for a CONDITIONAL decision',
    );
  }
}

/**
 * What a decision does to `Loan.status`, if anything.
 *
 * CONDITIONAL deliberately returns `null`: a conditional approval is not yet a
 * disbursement decision, and the loan stays IN_REVIEW until a further, unconditional
 * decision is recorded — the same reasoning `Loan`'s own status enum keeps APPROVED and
 * DISBURSED as two separate states rather than one.
 */
export function loanStatusForDecision(
  outcome: LenderDecisionOutcome,
): LoanStatus | null {
  switch (outcome) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'DECLINED';
    case 'CONDITIONAL':
      return null;
  }
}

/** A comfort letter is the bank's written follow-through on an approval — it makes no
 * sense before one exists, and refusing it here is cheaper than discovering later that a
 * PENDING loan somehow has a signed comfort letter on file with no decision behind it. */
const COMFORT_LETTER_ELIGIBLE_STATUSES: readonly LoanStatus[] = [
  'APPROVED',
  'DISBURSED',
  'ACTIVE',
  'IN_ARREARS',
  'CLOSED',
];

export function assertComfortLetterAllowed(loanStatus: LoanStatus): void {
  if (!COMFORT_LETTER_ELIGIBLE_STATUSES.includes(loanStatus)) {
    throw new BadRequestException(
      `Cannot upload a comfort letter while the loan is still ${loanStatus} — it needs a recorded APPROVED decision first`,
    );
  }
}
