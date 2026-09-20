import { describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PartyScope } from '@prisma/client';
import {
  assertOwnSupplierRecord,
  assertSupplyStaff,
  isSupplyStaff,
  normaliseOfferVin,
  SUPPLIER_REFUSAL,
  supplierIdForGrant,
} from './supplier-access';

describe('supply staff', () => {
  it('recognises the sourcing roles and nothing else', () => {
    expect(isSupplyStaff(['LOGISTICS_ADMIN'])).toBe(true);
    expect(isSupplyStaff(['SUPER_ADMIN'])).toBe(true);
    expect(isSupplyStaff(['MARKETPLACE_ADMIN'])).toBe(false);
    expect(isSupplyStaff(['SUPPLIER_PORTAL'])).toBe(false);
    expect(isSupplyStaff([])).toBe(false);
  });

  it('refuses a non-staff caller', () => {
    expect(() => assertSupplyStaff(['BUYER'])).toThrow(ForbiddenException);
    expect(() => assertSupplyStaff(['SUPER_ADMIN'])).not.toThrow();
  });
});

describe('the SUPPLIER partition', () => {
  const grant = {
    scope: PartyScope.SUPPLIER,
    supplierId: 'sup_mento',
    revokedAt: null,
  };

  it('resolves the supplier a live grant names', () => {
    expect(supplierIdForGrant(grant)).toBe('sup_mento');
  });

  it('refuses identically for no grant, wrong scope and a revoked grant', () => {
    const cases = [
      null,
      { ...grant, scope: PartyScope.LENDER },
      { ...grant, revokedAt: new Date() },
      { ...grant, supplierId: null },
    ];

    for (const input of cases) {
      let message: string | undefined;
      try {
        supplierIdForGrant(input);
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        message = (error as NotFoundException).message;
      }
      // Same answer every time: a supplier must not be able to tell which rule failed.
      expect(message).toBe(SUPPLIER_REFUSAL);
    }
  });

  it("never lets one supplier read another supplier's row", () => {
    expect(() =>
      assertOwnSupplierRecord('sup_mento', 'sup_mento'),
    ).not.toThrow();
    expect(() => assertOwnSupplierRecord('sup_mento', 'sup_mediateur')).toThrow(
      NotFoundException,
    );
    expect(() => assertOwnSupplierRecord('sup_mento', null)).toThrow(
      NotFoundException,
    );
  });
});

describe('offer VIN', () => {
  it('is optional at offer stage', () => {
    expect(normaliseOfferVin(undefined)).toBeNull();
    expect(normaliseOfferVin('   ')).toBeNull();
  });

  it('is normalised and validated when given', () => {
    expect(normaliseOfferVin(' jtdkb20u123456789 ')).toBe('JTDKB20U123456789');
  });

  it('rejects I, O, Q and a wrong length', () => {
    expect(() => normaliseOfferVin('JTDKB20U12345678I')).toThrow();
    expect(() => normaliseOfferVin('JTDKB20U12345678O')).toThrow();
    expect(() => normaliseOfferVin('JTDKB20U12345678Q')).toThrow();
    expect(() => normaliseOfferVin('JTDKB20U1234567')).toThrow();
  });
});
