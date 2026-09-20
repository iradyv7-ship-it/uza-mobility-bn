import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PartyScope } from '@prisma/client';

/**
 * Who may see what in the supply domain, as pure functions with no database and no Nest
 * dependencies — the same shape as `financing/lender-access.ts`, and for the same reason:
 * these rules carry a confidentiality commitment and must be readable and testable on
 * their own.
 *
 * The partition is not invented here. It is written down in `prisma/schema.prisma`
 * against `CounterpartyAccess` and restated in the PARTITIONS comment block:
 *
 *   "SUPPLIER scope -> SupplyOrder WHERE supplierId = theirs. Never FinancingRequest,
 *    never Listing prices, never another supplier's anything."
 *
 * This file implements exactly that sentence and nothing looser. Offers are added to the
 * same partition on the same terms: an offer belongs to a supplier, so a supplier user
 * sees their own and no other.
 */

/** UZA staff who run sourcing and the supply chain. Checked by name, via RolesGuard. */
export const SUPPLY_STAFF_ROLES: readonly string[] = [
  'SUPER_ADMIN',
  'LOGISTICS_ADMIN',
];

/**
 * The role a supplier's own login holds. It grants nothing by itself — every route also
 * resolves a `CounterpartyAccess` row, so a SUPPLIER_PORTAL user with no grant (or a
 * revoked one) sees nothing at all. The role says "this account is a counterparty
 * account"; the grant says which counterparty.
 */
export const SUPPLIER_PORTAL_ROLE = 'SUPPLIER_PORTAL';

/**
 * The one sentence a supplier is ever told when a record is not theirs.
 *
 * Defined once so no controller can invent a more helpful variant. "Not your supplier" and
 * "no such offer" must be indistinguishable, or a supplier can walk reference numbers and
 * learn which competitors UZA buys from and how much stock is moving.
 */
export const SUPPLIER_REFUSAL = 'No record available for that reference.';

export function isSupplyStaff(roles: readonly string[] = []): boolean {
  return roles.some((role) => SUPPLY_STAFF_ROLES.includes(role));
}

export function assertSupplyStaff(roles: readonly string[] = []): void {
  if (!isSupplyStaff(roles)) {
    throw new ForbiddenException(
      'Only UZA sourcing and supply-chain staff may do this.',
    );
  }
}

/** A `CounterpartyAccess` row, reduced to the fields the decision actually turns on. */
export interface CounterpartyGrant {
  scope: PartyScope;
  supplierId: string | null;
  revokedAt: Date | null;
}

/**
 * The supplier this caller acts for, or a refusal.
 *
 * Three ways to fail and one answer for all of them, deliberately: no grant, a grant of
 * the wrong scope, and a revoked grant are the same 404 to the caller. The distinction
 * belongs in the audit log, not in a status code.
 */
export function supplierIdForGrant(
  grant: CounterpartyGrant | null | undefined,
): string {
  if (
    !grant ||
    grant.scope !== PartyScope.SUPPLIER ||
    grant.revokedAt !== null ||
    !grant.supplierId
  ) {
    throw new NotFoundException(SUPPLIER_REFUSAL);
  }
  return grant.supplierId;
}

/**
 * Refuse a record that belongs to another supplier.
 *
 * Called on every read of a row that carries a `supplierId`, including rows already
 * fetched — a `where` clause that was right yesterday is not a substitute for checking the
 * row you are about to return.
 */
export function assertOwnSupplierRecord(
  callerSupplierId: string,
  recordSupplierId: string | null | undefined,
): void {
  if (!recordSupplierId || recordSupplierId !== callerSupplierId) {
    throw new NotFoundException(SUPPLIER_REFUSAL);
  }
}

/**
 * A VIN, if one was given.
 *
 * 17 characters, never I, O or Q — the same rule `SupplyOrderVehicle.vin` carries, applied
 * here because a VIN mistyped at offer stage is a VIN mistyped on the Addendum. Unlike the
 * order model, absence is allowed: at offer stage the unit is often still an auction lot
 * with no VIN allocated to UZA.
 */
export function normaliseOfferVin(
  vin: string | null | undefined,
): string | null {
  const raw = vin?.trim().toUpperCase();
  if (!raw) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(raw)) {
    throw new BadRequestException(
      'A VIN is 17 characters and never contains I, O or Q. Leave it empty if the unit has no VIN yet.',
    );
  }
  return raw;
}
