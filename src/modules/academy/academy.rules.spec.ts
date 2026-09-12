import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  COMPREHENSION_QUESTIONS,
  CURRICULUM,
  nextRetestDue,
  readinessSummary,
  scoreFromAnswers,
  type AssessmentRow,
  type AttendanceRow,
} from './academy.rules';

const six = (correct: number) =>
  COMPREHENSION_QUESTIONS.map((questionCode, i) => ({
    questionCode,
    correct: i < correct,
  }));

describe('the curriculum as data', () => {
  it('has unique codes and covers all four kinds', () => {
    const codes = CURRICULUM.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const k of ['VEHICLE', 'SAFETY', 'LITERACY', 'BUSINESS']) {
      expect(CURRICULUM.some((m) => m.kind === k)).toBe(true);
    }
  });

  it('begins with The Jump, because nothing else happens before it', () => {
    expect(
      [...CURRICULUM].sort((a, b) => a.sequence - b.sequence)[0].code,
    ).toBe('1.0');
  });
});

describe('a comprehension score', () => {
  it('is computed from six recorded answers, never typed in', () => {
    expect(scoreFromAnswers(six(6))).toBe(100);
    expect(scoreFromAnswers(six(5))).toBe(83);
    expect(scoreFromAnswers(six(4))).toBe(67);
    expect(scoreFromAnswers(six(0))).toBe(0);
  });

  it('refuses a partial set, an unknown question, or a repeat', () => {
    expect(() => scoreFromAnswers(six(6).slice(0, 5))).toThrow(
      /Missing: LIT-Q6/,
    );
    expect(() =>
      scoreFromAnswers([...six(6), { questionCode: 'LIT-Q7', correct: true }]),
    ).toThrow(/Unknown: LIT-Q7/);
    expect(() =>
      scoreFromAnswers([
        ...six(6).slice(0, 5),
        { questionCode: 'LIT-Q1', correct: true },
      ]),
    ).toThrow(BadRequestException);
  });
});

describe('re-test scheduling', () => {
  const t0 = new Date('2026-09-12T00:00:00Z');
  it('is day 30 after the first, day 90 after the second, then nothing', () => {
    expect(nextRetestDue(t0, 0)?.toISOString().slice(0, 10)).toBe('2026-10-12');
    expect(nextRetestDue(t0, 1)?.toISOString().slice(0, 10)).toBe('2026-12-11');
    expect(nextRetestDue(t0, 2)).toBeNull();
  });
});

describe('the readiness summary a lender reads', () => {
  const all: AttendanceRow[] = CURRICULUM.map((m) => ({
    moduleCode: m.code,
    kind: m.kind,
    passed: true,
    attendedAt: new Date('2026-10-01'),
  }));
  const a = (
    id: string,
    pct: number,
    day: string,
    retestOfId: string | null = null,
  ): AssessmentRow => ({
    id,
    kind: 'COMPREHENSION',
    scorePct: pct,
    assessedAt: new Date(day),
    retestOfId,
  });

  it('certifies only when every module is passed and comprehension is at the mark', () => {
    expect(
      readinessSummary(CURRICULUM, all, [a('1', 83, '2026-10-01')]).certified,
    ).toBe(true);
    expect(
      readinessSummary(CURRICULUM, all, [a('1', 67, '2026-10-01')]).certified,
    ).toBe(false);
    expect(
      readinessSummary(CURRICULUM, all.slice(1), [a('1', 100, '2026-10-01')])
        .certified,
    ).toBe(false);
  });

  it('flags a falling re-test score — the warning the re-tests exist to produce', () => {
    const s = readinessSummary(CURRICULUM, all, [
      a('1', 83, '2026-10-01'),
      a('2', 67, '2026-10-31', '1'),
    ]);
    expect(s.comprehension.trend).toBe('falling');
    expect(s.comprehension.retestsTaken).toBe(1);
    expect(s.warnings.join(' ')).toMatch(/fell from 83% to 67%/);
  });

  it('does not call a small wobble "falling"', () => {
    const s = readinessSummary(CURRICULUM, all, [
      a('1', 83, '2026-10-01'),
      a('2', 80, '2026-10-31', '1'),
    ]);
    expect(s.comprehension.trend).toBe('stable');
  });

  it('names The Jump specifically when it is not passed', () => {
    const withoutJump = all.filter((r) => r.moduleCode !== '1.0');
    const s = readinessSummary(CURRICULUM, withoutJump, [
      a('1', 100, '2026-10-01'),
    ]);
    expect(s.warnings.join(' ')).toMatch(/must not be issued a vehicle/);
  });

  it('counts by kind so a lender can see the shape, not just the total', () => {
    const s = readinessSummary(
      CURRICULUM,
      all.filter((r) => r.kind !== 'BUSINESS'),
      [],
    );
    expect(s.modules.BUSINESS.passed).toBe(0);
    expect(s.modules.VEHICLE.passed).toBe(s.modules.VEHICLE.total);
    expect(s.comprehension.trend).toBe('first');
    expect(s.comprehension.latestPct).toBeNull();
  });
});
