import { BadRequestException, ConflictException } from '@nestjs/common';
import { JourneyStage } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  ENROLMENT_ENTRY_STAGES,
  JOURNEY_STAGE_ORDER,
  assessEnrolmentReadiness,
  assessGaps,
  pickRelevantApplication,
  planEnrolmentTransition,
  stageNumber,
  type ApplicationOnFile,
  type GapRow,
} from './candidate-journey.rules';

function application(over: Partial<ApplicationOnFile> = {}): ApplicationOnFile {
  return {
    ref: 'UZM-APP-2026-000042',
    status: 'SUBMITTED',
    signedAt: new Date('2026-09-01T10:00:00Z'),
    signatureRef: 'sig_abc123',
    submittedAt: new Date('2026-09-01T10:00:00Z'),
    createdAt: new Date('2026-09-01T09:00:00Z'),
    ...over,
  };
}

function gap(over: Partial<GapRow> & { kind: GapRow['kind'] }): GapRow {
  return {
    status: 'OPEN',
    detail: null,
    shortfallRwf: null,
    raisedByRole: null,
    ...over,
  };
}

describe('the forty stages', () => {
  it('lists every stage the Prisma enum declares, exactly once', () => {
    // If migration 13's enum ever gains a stage, this fails rather than letting
    // stageNumber() silently return a number for a list that is missing one.
    const declared = Object.keys(JourneyStage) as JourneyStage[];
    expect(JOURNEY_STAGE_ORDER).toHaveLength(declared.length);
    expect([...JOURNEY_STAGE_ORDER].sort()).toEqual([...declared].sort());
  });

  it('numbers them as the schema comments do', () => {
    expect(stageNumber('REGISTERED')).toBe(1);
    expect(stageNumber('SCREENING')).toBe(2);
    expect(stageNumber('ENROLLED')).toBe(3);
    expect(stageNumber('CERTIFIED')).toBe(9);
    expect(stageNumber('ADVISED_TO_BUILD_FURTHER')).toBe(12);
    expect(stageNumber('VEHICLE_DELIVERED')).toBe(30);
    expect(stageNumber('EXITED_PROGRAMME')).toBe(40);
  });
});

describe('is the paperwork done', () => {
  it('is ready when the application is on file, signed and submitted', () => {
    const readiness = assessEnrolmentReadiness(application());
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.applicationRef).toBe('UZM-APP-2026-000042');
  });

  it('accepts an application already moved on to SCREENING or ACCEPTED', () => {
    expect(
      assessEnrolmentReadiness(application({ status: 'SCREENING' })).ready,
    ).toBe(true);
    expect(
      assessEnrolmentReadiness(application({ status: 'ACCEPTED' })).ready,
    ).toBe(true);
  });

  it('says so plainly when there is no application at all', () => {
    const readiness = assessEnrolmentReadiness(null);
    expect(readiness.ready).toBe(false);
    expect(readiness.applicationOnFile).toBe(false);
    expect(readiness.blockers[0]).toMatch(
      /No UZA Empower fund application on file/,
    );
  });

  it('refuses a draft', () => {
    const readiness = assessEnrolmentReadiness(
      application({ status: 'DRAFT', signedAt: null, signatureRef: null }),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(' ')).toMatch(/is not signed/);
    expect(readiness.blockers.join(' ')).toMatch(/still a draft/);
  });

  it('refuses a signedAt with no scanned signature behind it', () => {
    // A date somebody typed is not a contract. `signatureRef` is the image in private
    // GridFS, and without it there is nothing to produce later.
    const readiness = assessEnrolmentReadiness(
      application({ signatureRef: null }),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.applicationSigned).toBe(false);
  });

  it('refuses a signed application that was declined or withdrawn', () => {
    for (const status of ['DECLINED', 'WITHDRAWN'] as const) {
      const readiness = assessEnrolmentReadiness(application({ status }));
      expect(readiness.ready).toBe(false);
      expect(readiness.applicationSigned).toBe(true);
      expect(readiness.applicationSubmitted).toBe(false);
      expect(readiness.blockers.join(' ')).toContain(status);
    }
  });
});

describe('which application counts', () => {
  const signed = application({
    ref: 'UZM-APP-2026-000010',
    createdAt: new Date('2026-07-01T09:00:00Z'),
  });
  const abandonedDraft = application({
    ref: 'UZM-APP-2026-000044',
    status: 'DRAFT',
    signedAt: null,
    signatureRef: null,
    submittedAt: null,
    createdAt: new Date('2026-09-19T09:00:00Z'),
  });

  it('is null when there is nothing on file', () => {
    expect(pickRelevantApplication([])).toBeNull();
  });

  it('prefers the signed and submitted one over a newer abandoned draft', () => {
    // FundApplicationService refuses to edit a signed form, so a correction is a NEW
    // application. A July form that counts must not be shadowed by yesterday's draft.
    expect(pickRelevantApplication([abandonedDraft, signed])?.ref).toBe(
      'UZM-APP-2026-000010',
    );
  });

  it('takes the newest of several that all count', () => {
    const newer = application({
      ref: 'UZM-APP-2026-000099',
      createdAt: new Date('2026-09-10T09:00:00Z'),
    });
    expect(pickRelevantApplication([signed, newer])?.ref).toBe(
      'UZM-APP-2026-000099',
    );
  });

  it('falls back to the newest when none of them count', () => {
    expect(pickRelevantApplication([abandonedDraft])?.ref).toBe(
      'UZM-APP-2026-000044',
    );
  });
});

describe('sending a candidate to training', () => {
  const ready = assessEnrolmentReadiness(application());

  it('moves REGISTERED and SCREENING to ENROLLED', () => {
    for (const from of ENROLMENT_ENTRY_STAGES) {
      expect(planEnrolmentTransition(from, ready)).toEqual({
        from,
        to: 'ENROLLED',
        note: expect.stringContaining('UZM-APP-2026-000042') as string,
      });
    }
  });

  it('is a no-op once the candidate is already enrolled or further along', () => {
    // Confirming the same candidate's paperwork twice must not write a second
    // JourneyEvent claiming they entered training again.
    for (const from of [
      'ENROLLED',
      'TRAINING_IN_PROGRESS',
      'CERTIFIED',
      'VEHICLE_DELIVERED',
      'LOAN_CLOSED',
    ] as const) {
      expect(planEnrolmentTransition(from, ready)).toBeNull();
    }
  });

  it('refuses when the paperwork is not done, quoting the blockers', () => {
    const notReady = assessEnrolmentReadiness(null);
    expect(() => planEnrolmentTransition('SCREENING', notReady)).toThrow(
      BadRequestException,
    );
    expect(() => planEnrolmentTransition('SCREENING', notReady)).toThrow(
      /No UZA Empower fund application on file/,
    );
  });

  it('refuses to reopen a journey that ended, and points at a new one', () => {
    for (const from of [
      'ADVISED_TO_BUILD_FURTHER',
      'EXITED_PROGRAMME',
    ] as const) {
      expect(() => planEnrolmentTransition(from, ready)).toThrow(
        ConflictException,
      );
      expect(() => planEnrolmentTransition(from, ready)).toThrow(/RETURNING/);
    }
  });

  it('does not invent stages — every stage in the enum gets a defined answer', () => {
    for (const stage of JOURNEY_STAGE_ORDER) {
      let outcome: unknown;
      try {
        outcome = planEnrolmentTransition(stage, ready);
      } catch (error) {
        outcome = error;
      }
      const isTransitionToEnrolled =
        typeof outcome === 'object' &&
        outcome !== null &&
        'to' in outcome &&
        (outcome as { to: string }).to === 'ENROLLED';
      expect(
        outcome === null ||
          isTransitionToEnrolled ||
          outcome instanceof ConflictException,
      ).toBe(true);
    }
  });
});

describe('gaps are reported, never a gate', () => {
  const gaps: GapRow[] = [
    gap({
      kind: 'CONTRIBUTION_SHORT',
      shortfallRwf: 1_200_000n,
      raisedByRole: 'lender',
    }),
    gap({
      kind: 'NO_VERIFIABLE_INCOME',
      status: 'IN_PROGRESS',
      raisedByRole: 'uza',
    }),
    gap({ kind: 'NO_GPS_TRACKER', status: 'CLOSED_BY_PROGRAMME' }),
    gap({ kind: 'THIN_CREDIT_FILE', status: 'WAIVED_BY_LENDER' }),
  ];

  it('splits open from closed, counting IN_PROGRESS as open', () => {
    const assessment = assessGaps(gaps);
    expect(assessment.openCount).toBe(2);
    expect(assessment.closedCount).toBe(2);
  });

  it('sums only the gaps that carry an amount', () => {
    // A missing GPS tracker has no shortfall and must not be counted as zero-of-something.
    expect(assessGaps(gaps).openShortfallRwf).toBe(1_200_000);
    expect(
      assessGaps([gap({ kind: 'NO_GPS_TRACKER' })]).openShortfallRwf,
    ).toBeNull();
  });

  it('counts what the lender itself raised separately', () => {
    expect(assessGaps(gaps).raisedByLenderCount).toBe(1);
  });

  it('never affects the transition — a candidate with open gaps still enrols', () => {
    // This is the programme's premise: training is how gaps get closed, so the classroom
    // is exactly where somebody with eight open gaps belongs.
    const ready = assessEnrolmentReadiness(application());
    expect(assessGaps(gaps).openCount).toBeGreaterThan(0);
    expect(planEnrolmentTransition('SCREENING', ready)?.to).toBe('ENROLLED');
  });

  it('handles a candidate with no gaps recorded at all', () => {
    const assessment = assessGaps([]);
    expect(assessment).toMatchObject({
      openCount: 0,
      closedCount: 0,
      openShortfallRwf: null,
      raisedByLenderCount: 0,
    });
  });
});
