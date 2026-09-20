import { BadRequestException, ConflictException } from '@nestjs/common';
import type {
  AllocationStatus,
  ConsignmentStatus,
  LoanStatus,
  UnitStatus,
} from '@prisma/client';

/**
 * Who may be promised which physical unit, and when that promise is refused.
 *
 * Pure functions, no database — the same shape as `inspection.rules.ts` and
 * `loan-servicing.rules.ts`, and for the same reason: these are the sentences a driver and
 * a bank officer are actually told, and they must be testable without a Postgres container.
 *
 * ── Why this module exists at all ────────────────────────────────────────────────────────
 *
 * Between "the bank approved you" and "here are the keys" sits a decision nobody had
 * written down: WHICH vehicle, out of the ones that actually landed, goes to WHICH person.
 * Done in a spreadsheet, that decision has two failure modes, both of which have happened
 * in programmes like this one:
 *
 *   1. The same VIN is promised to two people. Both are told they have a vehicle. One of
 *      them finds out at the yard. `Allocation.activeHoldUnitId` is the database's answer
 *      to this (a partial-unique column, NULL when the promise ends); the service catches
 *      its violation and turns it into a sentence rather than a 500.
 *   2. Somebody jumps the line and nobody can say why. `AllocationQueue` deliberately does
 *      NOT store a position — order is derived from `readyAt` here — and every departure
 *      from that order requires a written `priorityReason`. Jumping the queue stays
 *      possible, because reality sometimes requires it; it just cannot be invisible.
 */

/**
 * The statuses a unit may be promised from.
 *
 * `in_consignment` is included on purpose: a unit still on the water can be promised, and
 * that promise is precisely what the bank file's VEHICLE_ALLOCATION item needs before the
 * file can be submitted (see `bank-file-generator.service.ts`). What a unit at sea cannot
 * be is *fulfilled* — that is a separate transition, and `at_yard` is what it needs.
 */
export const ALLOCATABLE_UNIT_STATUSES: readonly UnitStatus[] = [
  'in_consignment',
  'at_yard',
];

/** A promise that still holds a unit. Anything else has released it. */
export const LIVE_ALLOCATION_STATUSES: readonly AllocationStatus[] = [
  'promised',
  'confirmed',
];

/**
 * How long an offer holds by default. A unit reserved indefinitely for someone who has
 * stopped answering is a unit not earning — the schema comment on `Allocation.expiresAt`
 * is the rule; this is only its default.
 */
export const DEFAULT_OFFER_DAYS = 7;
export const MAX_OFFER_DAYS = 45;

/** Loan states from which a vehicle may honestly be promised. */
const ALLOCATABLE_LOAN_STATUSES: readonly LoanStatus[] = [
  'APPROVED',
  'DISBURSED',
  'ACTIVE',
];

export function assertUnitAllocatable(unit: {
  ref: string;
  status: UnitStatus;
}): void {
  if (ALLOCATABLE_UNIT_STATUSES.includes(unit.status)) return;

  // Each message names the unit and what state it is actually in, because the person
  // reading it is an allocations officer with the yard sheet in front of them.
  const why: Record<string, string> = {
    allocated: 'is already promised to someone',
    registered: 'has already been registered to an owner',
    delivered: 'has already been delivered',
    returned: 'was returned and is not available',
  };
  throw new ConflictException(
    `Unit ${unit.ref} ${why[unit.status] ?? `is ${unit.status}`} and cannot be allocated.`,
  );
}

/**
 * What a unit's status becomes when a promise over it ends (declined, lapsed, withdrawn).
 *
 * The unit's status before the promise is not stored anywhere, so it is derived from where
 * the consignment actually is rather than guessed. A consignment that has cleared customs
 * or reached the yard means the thing is physically here; anything earlier means it is not.
 * Inventing a "previous status" column to avoid this would be storing a fact we can already
 * compute from one we keep current.
 */
export function unitStatusOnRelease(
  consignmentStatus: ConsignmentStatus,
): UnitStatus {
  return consignmentStatus === 'cleared' ||
    consignmentStatus === 'at_yard' ||
    consignmentStatus === 'distributed'
    ? 'at_yard'
    : 'in_consignment';
}

/**
 * A vehicle is promised against an approved loan, not a hopeful one.
 *
 * Promising a specific VIN to someone whose file is still with the bank produces exactly
 * the situation this module exists to prevent: a unit held out of the pool for a driver who
 * may be declined next week.
 */
export function assertLoanAllocatable(loan: {
  reference: string;
  status: LoanStatus;
}): void {
  if (ALLOCATABLE_LOAN_STATUSES.includes(loan.status)) return;

  if (loan.status === 'DECLINED') {
    throw new BadRequestException(
      `Loan ${loan.reference} was declined. No vehicle can be allocated against it.`,
    );
  }
  if (loan.status === 'CLOSED') {
    throw new BadRequestException(
      `Loan ${loan.reference} is closed. No vehicle can be allocated against it.`,
    );
  }
  throw new BadRequestException(
    `Loan ${loan.reference} is ${loan.status}; a vehicle is allocated once the lender has approved it.`,
  );
}

export function assertOfferWindow(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_OFFER_DAYS) {
    throw new BadRequestException(
      `An offer holds for between 1 and ${MAX_OFFER_DAYS} days.`,
    );
  }
}

export function offerExpiry(promisedAt: Date, days: number): Date {
  return new Date(promisedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** One person's place in the line, as the ordering functions need to see it. */
export interface QueueEntry {
  id: string;
  ref: string;
  uzaId: string;
  classCode: string;
  readyAt: Date;
  active: boolean;
  /** True when this person already holds a live promise and is therefore not next. */
  hasLiveAllocation: boolean;
}

export type OrderedQueueEntry = QueueEntry & { position: number };

/**
 * The line, derived rather than stored.
 *
 * Order is `readyAt` ascending — when the person became genuinely ready, not when they
 * enquired. Ties break on `ref`, which is monotonic, so two people ready at the same
 * recorded instant get a stable answer instead of whatever Postgres returns that day.
 * Inactive entries and people already holding a promise are excluded: they are not waiting.
 */
export function orderQueue(
  entries: readonly QueueEntry[],
): OrderedQueueEntry[] {
  return entries
    .filter((e) => e.active && !e.hasLiveAllocation)
    .slice()
    .sort(
      (a, b) =>
        a.readyAt.getTime() - b.readyAt.getTime() || a.ref.localeCompare(b.ref),
    )
    .map((e, i) => ({ ...e, position: i + 1 }));
}

export function assertQueueReady(
  entry: { ref: string; active: boolean; readyAt: Date },
  now: Date = new Date(),
): void {
  if (!entry.active) {
    throw new BadRequestException(
      `Queue entry ${entry.ref} is not active. Reactivate it before allocating.`,
    );
  }
  if (entry.readyAt.getTime() > now.getTime()) {
    throw new BadRequestException(
      `Queue entry ${entry.ref} is not ready until ${entry.readyAt.toISOString().slice(0, 10)}.`,
    );
  }
}

/**
 * Allocating out of readiness order is allowed and must be written down.
 *
 * Returns the reason to persist on the queue entry when the line is being jumped, or null
 * when the allocation is simply to whoever is next. `AllocationQueue.priorityReason` and
 * `prioritisedById` exist for exactly this, and the schema says the service is what makes
 * them required — this is that service rule.
 */
export function priorityReasonFor(
  targetQueueId: string,
  ordered: readonly OrderedQueueEntry[],
  priorityReason: string | undefined,
): string | null {
  const front = ordered[0];
  if (front && front.id === targetQueueId) return null;

  const reason = priorityReason?.trim();
  if (!reason) {
    const aheadOf = front
      ? ` ${front.ref} (ready ${front.readyAt.toISOString().slice(0, 10)}) is next in line.`
      : '';
    throw new BadRequestException(
      `This allocation is out of readiness order, so it needs a written reason.${aheadOf}`,
    );
  }
  if (reason.length < 10) {
    throw new BadRequestException(
      'Give a real reason for jumping the queue — at least a sentence.',
    );
  }
  return reason;
}

/**
 * The supplier's claim over the vehicle, matched by VIN.
 *
 * `SupplyOrderVehicle` and `ConsignmentUnit` are two different partitions of the estate and
 * there is NO foreign key between them — the only thing they share is the VIN. So this can
 * only be checked for a unit that has one; a bike that arrived on a frame number is matched
 * against nothing and passes, which is honest rather than safe, and is stated here so
 * nobody later reads a pass as proof.
 *
 * The rule itself is the one written on the schema: a balance still owed, or a balance paid
 * with the security still unreleased, is an open claim against an asset someone else may
 * already have financed. Promising it to a driver is how that becomes their problem.
 */
export function assertSupplierEncumbranceCleared(
  unitRef: string,
  supply: {
    vin: string;
    balanceDueMinor: bigint | null;
    balancePaidOn: Date | null;
    securityReleasedOn: Date | null;
  } | null,
): void {
  if (!supply) return;

  const owes = (supply.balanceDueMinor ?? 0n) > 0n && !supply.balancePaidOn;
  if (owes) {
    throw new ConflictException(
      `Unit ${unitRef} (VIN ${supply.vin}) still carries a supplier balance. Clear it before promising the vehicle to a driver.`,
    );
  }
  if (supply.balancePaidOn && !supply.securityReleasedOn) {
    throw new ConflictException(
      `Unit ${unitRef} (VIN ${supply.vin}) is paid for but the supplier's security has not been released. That is an open claim against the vehicle.`,
    );
  }
}

/** Only a live promise can be accepted, declined or withdrawn. */
export function assertRespondable(allocation: {
  ref: string;
  status: AllocationStatus;
}): void {
  if (allocation.status === 'promised') return;
  throw new ConflictException(
    `Allocation ${allocation.ref} is ${allocation.status}; only a live promise can be answered.`,
  );
}

/** A promise whose clock has run out has not been answered in time. */
export function hasLapsed(
  allocation: { status: AllocationStatus; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return (
    allocation.status === 'promised' &&
    allocation.expiresAt.getTime() <= now.getTime()
  );
}
