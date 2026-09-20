import { BadRequestException, ConflictException } from '@nestjs/common';
import type {
  FundApplicationStatus,
  GapKind,
  GapStatus,
  JourneyStage,
} from '@prisma/client';

/**
 * When a candidate becomes a trainee, and what is allowed to move them.
 *
 * Pure functions, no database — the same shape as `allocation.rules.ts` and
 * `fund-application.rules.ts`. These are the sentences the head of UZA Mobility is actually
 * shown when a candidate cannot yet be sent to training, so they have to be testable
 * without a Postgres container.
 *
 * ── The one transition this file owns ────────────────────────────────────────────────────
 *
 * REGISTERED (1) or SCREENING (2) → ENROLLED (3), and only when a UZA Empower fund
 * application is on file AND signed AND submitted. That is the workflow as the founder
 * described it: Scorah puts the list together and makes sure each candidate's application
 * is signed; once it is, the candidate is approved to be trained and appears in Bosco's
 * workplace. Nothing else in the forty stages is decided here.
 *
 * ── Gaps do not block training ───────────────────────────────────────────────────────────
 *
 * `EligibilityGap` rows are surfaced read-only by `assessGaps` and are deliberately NOT an
 * input to the transition. The whole premise of the programme, written into migration 13's
 * own commit message, is that training, savings and placement are HOW gaps get closed. A
 * candidate with eight open gaps is the candidate who most needs the classroom; refusing
 * them entry until the gaps close would invert the programme.
 *
 * ── The stage numbering is the spec's, not ours ──────────────────────────────────────────
 *
 * `JOURNEY_STAGE_ORDER` restates the forty stages in the exact order migration 13 declares
 * them, so `stageNumber` returns the number written in the schema's own comments (1..40).
 * It is not a new ordering and no stage is added, removed or renumbered here; the spec
 * beside this file asserts it stays in step with the Prisma enum.
 */

export const JOURNEY_STAGE_ORDER: readonly JourneyStage[] = [
  'REGISTERED', //  1
  'SCREENING', //  2
  'ENROLLED', //  3
  'TRAINING_IN_PROGRESS', //  4
  'SAVINGS_RECORD_BUILDING', //  5
  'ASSESSMENT_SCHEDULED', //  6
  'ASSESSMENT_PASSED', //  7
  'REASSESSMENT_REQUIRED', //  8
  'CERTIFIED', //  9
  'READINESS_SCORE_PUBLISHED', // 10
  'PLACED_IN_DRIVERS_POOL', // 11
  'ADVISED_TO_BUILD_FURTHER', // 12
  'VEHICLE_SELECTED', // 13
  'APPLICATION_SUBMITTED', // 14
  'LENDER_DOCUMENTS_REQUESTED', // 15
  'LENDER_UNDER_REVIEW', // 16
  'LENDER_INTERVIEW_SCHEDULED', // 17
  'LENDER_APPROVED_IN_PRINCIPLE', // 18
  'LENDER_CONDITIONS_TO_SATISFY', // 19
  'LENDER_DECLINED', // 20
  'COLLATERAL_REQUESTED', // 21
  'COLLATERAL_POSTED', // 22
  'INSURANCE_QUOTE_REQUESTED', // 23
  'INSURANCE_QUOTED', // 24
  'INSURANCE_POLICY_ISSUED', // 25
  'VEHICLE_ORDERED', // 26
  'VEHICLE_IN_TRANSIT', // 27
  'VEHICLE_CUSTOMS', // 28
  'VEHICLE_REGISTERED', // 29
  'VEHICLE_DELIVERED', // 30
  'LOAN_DISBURSED', // 31
  'REPAYMENT_ACTIVE', // 32
  'PAYMENT_DUE_SOON', // 33
  'ARREARS', // 34
  'SUPPORT_REQUESTED', // 35
  'RESTRUCTURE_UNDER_DISCUSSION', // 36
  'COLLATERAL_TRANCHE_ELIGIBLE', // 37
  'COLLATERAL_RELEASED', // 38
  'LOAN_CLOSED', // 39
  'EXITED_PROGRAMME', // 40
];

/** The stage's number as the portal spec and the schema comments give it. 1-based. */
export function stageNumber(stage: JourneyStage): number {
  const index = JOURNEY_STAGE_ORDER.indexOf(stage);
  if (index < 0) {
    throw new BadRequestException(`${stage} is not a journey stage.`);
  }
  return index + 1;
}

/** The stages a candidate may be sent to training FROM. */
export const ENROLMENT_ENTRY_STAGES: readonly JourneyStage[] = [
  'REGISTERED',
  'SCREENING',
];

/**
 * Stages from which this transition is refused outright rather than treated as done.
 *
 * Both are ends of a journey, and `IntakeSource.RETURNING` is the schema's own answer for
 * somebody who comes back: a NEW journey row, not a revived one. Quietly advancing an
 * exited candidate would lose the fact that they left, which is exactly the number migration
 * 13 says a funder looks at first.
 */
export const CLOSED_JOURNEY_STAGES: readonly JourneyStage[] = [
  'ADVISED_TO_BUILD_FURTHER',
  'EXITED_PROGRAMME',
];

/**
 * An application that has actually been put in.
 *
 * `commitment.service.ts` treats a signature OR one of these statuses as evidence of
 * submission. This gate is stricter and requires both, because those two are answering
 * different questions: the commitment ladder asks "has this person shown seriousness", and
 * a form keyed in but not yet signed is real evidence of that. This asks "may we spend a
 * training place on them", and DECLINED or WITHDRAWN is a no however signed the paper is.
 */
export const SUBMITTED_APPLICATION_STATUSES: readonly FundApplicationStatus[] =
  ['SUBMITTED', 'SCREENING', 'ACCEPTED'];

/** A gap the programme still has work to do on. */
export const OPEN_GAP_STATUSES: readonly GapStatus[] = ['OPEN', 'IN_PROGRESS'];

/** Only the application fields this gate reads. Keeps it testable without Prisma. */
export interface ApplicationOnFile {
  ref: string;
  status: FundApplicationStatus;
  signedAt: Date | null;
  signatureRef: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}

/**
 * Which of a person's applications this gate is about.
 *
 * A candidate can have more than one: `FundApplicationService.update` refuses to edit a
 * signed form, so a correction is deliberately a NEW application rather than an amendment.
 * The rule is therefore "the newest one that actually counts, else the newest one at all" —
 * a signed and submitted form from July still approves training in September, and it must
 * not be shadowed by a draft correction somebody started and abandoned yesterday.
 */
export function pickRelevantApplication<T extends ApplicationOnFile>(
  applications: readonly T[],
): T | null {
  if (!applications.length) return null;
  const newestFirst = [...applications].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return (
    newestFirst.find((a) => assessEnrolmentReadiness(a).ready) ?? newestFirst[0]
  );
}

export interface EnrolmentReadiness {
  ready: boolean;
  /** Sentences a human can act on. Empty when ready. */
  blockers: string[];
  applicationRef: string | null;
  applicationOnFile: boolean;
  applicationSigned: boolean;
  applicationSubmitted: boolean;
}

/**
 * Is this candidate approved to be trained?
 *
 * Returns the finding rather than throwing, so the same function serves both the list
 * Scorah works from (where "not ready, and here is why" is the normal answer for most rows)
 * and the transition itself.
 */
export function assessEnrolmentReadiness(
  application: ApplicationOnFile | null,
): EnrolmentReadiness {
  const blockers: string[] = [];

  if (!application) {
    return {
      ready: false,
      blockers: [
        'No UZA Empower fund application on file. Record one before sending this candidate to training.',
      ],
      applicationRef: null,
      applicationOnFile: false,
      applicationSigned: false,
      applicationSubmitted: false,
    };
  }

  // A signature is the contract. `signatureRef` points at the scanned image in private
  // GridFS, and a `signedAt` without one is a date somebody typed.
  const signed = !!application.signedAt && !!application.signatureRef;
  if (!signed) {
    blockers.push(
      `Application ${application.ref} is not signed. The applicant signs in front of a witness and the form is scanned before training is approved.`,
    );
  }

  const submitted = SUBMITTED_APPLICATION_STATUSES.includes(application.status);
  if (!submitted) {
    blockers.push(
      application.status === 'DRAFT'
        ? `Application ${application.ref} is still a draft.`
        : `Application ${application.ref} is ${application.status} and cannot carry a candidate into training.`,
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    applicationRef: application.ref,
    applicationOnFile: true,
    applicationSigned: signed,
    applicationSubmitted: submitted,
  };
}

export interface StageTransition {
  from: JourneyStage;
  to: JourneyStage;
  note: string;
}

/**
 * The move, or null when there is nothing to do.
 *
 * `null` means already enrolled or further along — this is called every time Scorah
 * confirms a candidate's paperwork, and confirming twice must not write a second
 * `JourneyEvent` claiming the person entered training again.
 *
 * Throws when the move is refused, and each message names what to do instead.
 */
export function planEnrolmentTransition(
  current: JourneyStage,
  readiness: EnrolmentReadiness,
): StageTransition | null {
  if (CLOSED_JOURNEY_STAGES.includes(current)) {
    throw new ConflictException(
      `This journey ended at ${current}. Somebody coming back starts a new journey with intake source RETURNING rather than reopening this one.`,
    );
  }

  if (!ENROLMENT_ENTRY_STAGES.includes(current)) {
    // Past ENROLLED already. Nothing to do, and nothing wrong.
    if (stageNumber(current) >= stageNumber('ENROLLED')) return null;
    throw new ConflictException(
      `A candidate is enrolled from ${ENROLMENT_ENTRY_STAGES.join(' or ')}, not from ${current}.`,
    );
  }

  if (!readiness.ready) {
    throw new BadRequestException(readiness.blockers.join(' '));
  }

  return {
    from: current,
    to: 'ENROLLED',
    note: readiness.applicationRef
      ? `Fund application ${readiness.applicationRef} signed and submitted; approved for training.`
      : 'Approved for training.',
  };
}

/** Only the gap fields the read surface needs. */
export interface GapRow {
  kind: GapKind;
  status: GapStatus;
  detail: string | null;
  shortfallRwf: bigint | null;
  raisedByRole: string | null;
}

export interface GapAssessment {
  open: GapRow[];
  closed: GapRow[];
  openCount: number;
  closedCount: number;
  /** Whole RWF across open gaps that carry an amount. Null when none do. */
  openShortfallRwf: number | null;
  /** Gaps a lender raised itself, which carry more weight than ones UZA guessed at. */
  raisedByLenderCount: number;
}

/**
 * The gaps, split into what is still open and what the programme has closed.
 *
 * Read-only and advisory. Nothing here feeds `planEnrolmentTransition` — see the note at
 * the head of this file. The shortfall is summed only over gaps that carry an amount,
 * because a missing GPS tracker has no amount and inventing one would make the reporting
 * lie (migration 13 says so on the column itself).
 */
export function assessGaps(gaps: readonly GapRow[]): GapAssessment {
  const open = gaps.filter((g) => OPEN_GAP_STATUSES.includes(g.status));
  const closed = gaps.filter((g) => !OPEN_GAP_STATUSES.includes(g.status));

  const amounts = open
    .map((g) => g.shortfallRwf)
    .filter((v): v is bigint => v !== null);

  return {
    open,
    closed,
    openCount: open.length,
    closedCount: closed.length,
    openShortfallRwf: amounts.length
      ? Number(amounts.reduce((total, v) => total + v, 0n))
      : null,
    raisedByLenderCount: open.filter(
      (g) => g.raisedByRole?.trim().toLowerCase() === 'lender',
    ).length,
  };
}
