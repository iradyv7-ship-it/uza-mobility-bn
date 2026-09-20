import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFER_DAYS,
  assertLoanAllocatable,
  assertOfferWindow,
  assertQueueReady,
  assertRespondable,
  assertSupplierEncumbranceCleared,
  assertUnitAllocatable,
  hasLapsed,
  offerExpiry,
  orderQueue,
  priorityReasonFor,
  unitStatusOnRelease,
  type QueueEntry,
} from './allocation.rules';

const NOW = new Date('2026-09-20T09:00:00Z');

function entry(over: Partial<QueueEntry> & { ref: string }): QueueEntry {
  return {
    id: over.ref,
    uzaId: `UZA-${over.ref}`,
    classCode: 'CAR',
    readyAt: new Date('2026-01-01T00:00:00Z'),
    active: true,
    hasLiveAllocation: false,
    ...over,
  };
}

describe('which units may be promised', () => {
  it('allows a unit at the yard and one still in the consignment', () => {
    // A unit on the water can be promised — the bank file cannot be submitted without
    // one. What it cannot be is fulfilled.
    expect(() =>
      assertUnitAllocatable({ ref: 'UZM-UNT-1', status: 'at_yard' }),
    ).not.toThrow();
    expect(() =>
      assertUnitAllocatable({ ref: 'UZM-UNT-1', status: 'in_consignment' }),
    ).not.toThrow();
  });

  it('refuses a unit already promised, and names it', () => {
    expect(() =>
      assertUnitAllocatable({ ref: 'UZM-UNT-9', status: 'allocated' }),
    ).toThrow(ConflictException);
    expect(() =>
      assertUnitAllocatable({ ref: 'UZM-UNT-9', status: 'allocated' }),
    ).toThrow(/UZM-UNT-9 is already promised to someone/);
  });

  it('refuses a delivered, registered or returned unit', () => {
    for (const status of ['delivered', 'registered', 'returned'] as const) {
      expect(() => assertUnitAllocatable({ ref: 'UZM-UNT-9', status })).toThrow(
        ConflictException,
      );
    }
  });
});

describe('what a released unit goes back to', () => {
  it('goes back to the yard when the consignment has physically landed', () => {
    expect(unitStatusOnRelease('at_yard')).toBe('at_yard');
    expect(unitStatusOnRelease('cleared')).toBe('at_yard');
    expect(unitStatusOnRelease('distributed')).toBe('at_yard');
  });

  it('stays in the consignment while it is still moving', () => {
    expect(unitStatusOnRelease('planned')).toBe('in_consignment');
    expect(unitStatusOnRelease('in_transit')).toBe('in_consignment');
    expect(unitStatusOnRelease('arrived_port')).toBe('in_consignment');
  });
});

describe('allocating against a loan', () => {
  it('accepts an approved, disbursed or active loan', () => {
    for (const status of ['APPROVED', 'DISBURSED', 'ACTIVE'] as const) {
      expect(() =>
        assertLoanAllocatable({ reference: 'UZM-LN-1', status }),
      ).not.toThrow();
    }
  });

  it('refuses a loan still with the bank — that unit would be held for nobody', () => {
    expect(() =>
      assertLoanAllocatable({ reference: 'UZM-LN-1', status: 'IN_REVIEW' }),
    ).toThrow(
      /IN_REVIEW; a vehicle is allocated once the lender has approved it/,
    );
  });

  it('refuses a declined and a closed loan in their own words', () => {
    expect(() =>
      assertLoanAllocatable({ reference: 'UZM-LN-2', status: 'DECLINED' }),
    ).toThrow(/was declined/);
    expect(() =>
      assertLoanAllocatable({ reference: 'UZM-LN-3', status: 'CLOSED' }),
    ).toThrow(/is closed/);
  });
});

describe('the offer clock', () => {
  it('rejects a window outside 1-45 days, and a fractional one', () => {
    expect(() => assertOfferWindow(0)).toThrow(BadRequestException);
    expect(() => assertOfferWindow(46)).toThrow(BadRequestException);
    expect(() => assertOfferWindow(7.5)).toThrow(BadRequestException);
    expect(() => assertOfferWindow(DEFAULT_OFFER_DAYS)).not.toThrow();
  });

  it('expires the default window a week out', () => {
    expect(offerExpiry(NOW, DEFAULT_OFFER_DAYS).toISOString()).toBe(
      '2026-09-27T09:00:00.000Z',
    );
  });

  it('counts a promise as lapsed only once the clock has actually run out', () => {
    const expiresAt = new Date('2026-09-19T09:00:00Z');
    expect(hasLapsed({ status: 'promised', expiresAt }, NOW)).toBe(true);
    expect(
      hasLapsed({ status: 'promised', expiresAt: new Date('2026-10-01') }, NOW),
    ).toBe(false);
    // Already answered. The clock is irrelevant.
    expect(hasLapsed({ status: 'confirmed', expiresAt }, NOW)).toBe(false);
  });
});

describe('the line, derived rather than stored', () => {
  const a = entry({ ref: 'AQ-1', readyAt: new Date('2026-03-01') });
  const b = entry({ ref: 'AQ-2', readyAt: new Date('2026-01-15') });
  const c = entry({ ref: 'AQ-3', readyAt: new Date('2026-02-01') });

  it('orders by readiness, not by when they enquired', () => {
    expect(orderQueue([a, b, c]).map((e) => e.ref)).toEqual([
      'AQ-2',
      'AQ-3',
      'AQ-1',
    ]);
    expect(orderQueue([a, b, c]).map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it('breaks an exact tie on ref, so two screens never disagree', () => {
    const same = new Date('2026-02-02');
    const x = entry({ ref: 'AQ-9', readyAt: same });
    const y = entry({ ref: 'AQ-4', readyAt: same });
    expect(orderQueue([x, y]).map((e) => e.ref)).toEqual(['AQ-4', 'AQ-9']);
  });

  it('leaves out inactive entries and anyone already holding a promise', () => {
    const inactive = entry({ ref: 'AQ-5', active: false });
    const holding = entry({ ref: 'AQ-6', hasLiveAllocation: true });
    expect(orderQueue([a, inactive, holding]).map((e) => e.ref)).toEqual([
      'AQ-1',
    ]);
  });

  it('refuses a queue entry that is not yet ready, and says when it will be', () => {
    expect(() =>
      assertQueueReady(
        { ref: 'AQ-7', active: true, readyAt: new Date('2026-12-01') },
        NOW,
      ),
    ).toThrow(/not ready until 2026-12-01/);
  });

  it('refuses an inactive queue entry', () => {
    expect(() =>
      assertQueueReady(
        { ref: 'AQ-8', active: false, readyAt: new Date('2026-01-01') },
        NOW,
      ),
    ).toThrow(/is not active/);
  });
});

describe('jumping the queue is possible and never invisible', () => {
  const ordered = orderQueue([
    entry({ ref: 'AQ-1', readyAt: new Date('2026-01-15') }),
    entry({ ref: 'AQ-2', readyAt: new Date('2026-03-01') }),
  ]);

  it('needs no reason when the allocation goes to whoever is next', () => {
    expect(priorityReasonFor('AQ-1', ordered, undefined)).toBeNull();
  });

  it('refuses an out-of-order allocation with no reason, and names who was next', () => {
    expect(() => priorityReasonFor('AQ-2', ordered, undefined)).toThrow(
      /out of readiness order.*AQ-1 \(ready 2026-01-15\) is next in line/s,
    );
  });

  it('refuses a token reason like "urgent"', () => {
    expect(() => priorityReasonFor('AQ-2', ordered, 'urgent')).toThrow(
      /at least a sentence/,
    );
  });

  it('returns the trimmed reason to be written onto the queue entry', () => {
    expect(
      priorityReasonFor(
        'AQ-2',
        ordered,
        '  Replacement for the unit written off on 12 Sep.  ',
      ),
    ).toBe('Replacement for the unit written off on 12 Sep.');
  });
});

describe("the supplier's claim over the vehicle", () => {
  const clear = {
    vin: 'LSJA24U67NZ000001',
    balanceDueMinor: 0n,
    balancePaidOn: new Date('2026-08-01'),
    securityReleasedOn: new Date('2026-08-05'),
  };

  it('passes a vehicle with nothing owed and the security released', () => {
    expect(() =>
      assertSupplierEncumbranceCleared('UZM-UNT-1', clear),
    ).not.toThrow();
  });

  it('blocks a vehicle with a supplier balance still due', () => {
    expect(() =>
      assertSupplierEncumbranceCleared('UZM-UNT-1', {
        ...clear,
        balanceDueMinor: 4_500_000n,
        balancePaidOn: null,
        securityReleasedOn: null,
      }),
    ).toThrow(/still carries a supplier balance/);
  });

  it('blocks a paid vehicle whose security has not been released — an open claim', () => {
    expect(() =>
      assertSupplierEncumbranceCleared('UZM-UNT-1', {
        ...clear,
        securityReleasedOn: null,
      }),
    ).toThrow(ConflictException);
  });

  it('passes when there is no matching supply record at all', () => {
    // A bike that arrived on a frame number matches nothing. Honest, not safe — this test
    // exists so nobody later reads a pass here as proof the vehicle is unencumbered.
    expect(() =>
      assertSupplierEncumbranceCleared('UZM-UNT-2', null),
    ).not.toThrow();
  });
});

describe('answering a promise', () => {
  it('accepts an answer to a live promise', () => {
    expect(() =>
      assertRespondable({ ref: 'UZM-ALC-1', status: 'promised' }),
    ).not.toThrow();
  });

  it('refuses to re-answer one that is already settled', () => {
    for (const status of [
      'confirmed',
      'declined',
      'fulfilled',
      'lapsed',
    ] as const) {
      expect(() => assertRespondable({ ref: 'UZM-ALC-1', status })).toThrow(
        ConflictException,
      );
    }
  });
});
