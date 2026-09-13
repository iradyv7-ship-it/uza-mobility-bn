import { BadRequestException } from '@nestjs/common';

/**
 * The academy's rules, as pure functions.
 *
 * The data model for training existed before any code used it — `AcademyModule`,
 * `Enrolment`, `ModuleAttendance`, `Assessment` — and it is a good model: the oral
 * six-question comprehension test, the day-30 and day-90 re-tests, the recording that
 * attaches to the bank file. What did not exist was a role that could write to it or a
 * route that read from it. Training completion is the FIRST item on NCBA's list of what
 * they want in exchange for 18% and no collateral, and until 12 September 2026 nobody could
 * record it.
 *
 * Everything here is what a lender is relying on when it reads "trained": that the modules
 * are the curriculum's modules, that a score is computed from recorded answers and not
 * typed in, that a re-test happened when it should have, and that a falling score is
 * surfaced as the warning it is.
 */

export type ModuleKindCode = 'VEHICLE' | 'SAFETY' | 'LITERACY' | 'BUSINESS';

export interface CurriculumModule {
  code: string;
  title: string;
  kind: ModuleKindCode;
  hours: number;
  sequence: number;
  deliveredByPartner?: string;
  summary: string;
  /** The name a participant will say. From the Kinyarwanda glossary; pending native review. */
  titleRw: string;
}

/**
 * The curriculum, as data. Mirrors `03-uza-empower/training/curriculum-thesis.md` §4; if
 * the thesis changes a module, this list changes with it. Codes are the thesis's own
 * module numbers so a trainer and a document reader are talking about the same thing.
 */
export const CURRICULUM: readonly CurriculumModule[] = [
  // Track 1 — OPERATE
  {
    code: '1.0',
    titleRw: 'Isimbuka',
    title: 'The Jump: from a stick to a silent car',
    kind: 'VEHICLE',
    hours: 3,
    sequence: 10,
    summary:
      'Closed lot. Five motor habits replaced one per session. Hard gate before any road time.',
  },
  {
    code: '1.1',
    titleRw: "Imodoka y'umuriro",
    title: 'What an electric car is',
    kind: 'VEHICLE',
    hours: 1.5,
    sequence: 11,
    summary: 'Bonnet open. Point and name, ten items from memory.',
  },
  {
    code: '1.2',
    titleRw: 'Gushyiramo umuriro',
    title: 'Charging',
    kind: 'VEHICLE',
    hours: 2,
    sequence: 12,
    summary:
      'AC vs DC, the connector, RWF 110/kWh, the arithmetic on their own phone. Full public charge unaided.',
  },
  {
    code: '1.3',
    titleRw: "Umuriro n'urugendo rw'umunsi",
    title: 'Range and the day',
    kind: 'VEHICLE',
    hours: 1.5,
    sequence: 13,
    summary: 'State of charge as a budget. Plan a Kigali working day aloud.',
  },
  {
    code: '1.4',
    titleRw: 'Gutwara neza, ukazigama',
    title: 'Efficient driving',
    kind: 'VEHICLE',
    hours: 2,
    sequence: 14,
    summary:
      'Two instrumented laps, own style then coached. The RWF difference on the whiteboard.',
  },
  {
    code: '1.5',
    titleRw: 'Igenzura rya buri munsi',
    title: 'Daily and weekly checks',
    kind: 'VEHICLE',
    hours: 1,
    sequence: 15,
    summary:
      'The door-pocket card. Performed unaided while the trainer watches silently.',
  },
  {
    code: '1.6',
    titleRw: "Garage n'isuzuma rya buri kwezi",
    title: 'Servicing and the monthly inspection',
    kind: 'VEHICLE',
    hours: 1,
    sequence: 16,
    summary:
      'What voids the warranty. The monthly certified-garage inspection as part of owning the car.',
  },
  {
    code: '1.7',
    titleRw: 'Ubuzima bwa batiri',
    title: 'Battery health',
    kind: 'VEHICLE',
    hours: 1,
    sequence: 17,
    summary:
      'The battery ages ~2.3%/yr and the driver controls half of that. Fast charging, heat, extremes.',
  },
  {
    code: '1.8',
    titleRw: "Kubana n'imodoka yawe",
    title: 'Living with it',
    kind: 'VEHICLE',
    hours: 1,
    sequence: 18,
    summary:
      'Rain, washing, warning symbols, the 12-volt, towing. Who to call.',
  },
  // Track 2 — EARN
  {
    code: '2.1',
    titleRw: 'Intego ya buri munsi',
    title: 'The daily target',
    kind: 'LITERACY',
    hours: 1.5,
    sequence: 21,
    summary: 'Instalment ÷ working days, in their own numbers, every session.',
  },
  {
    code: '2.2',
    titleRw: 'Igikapu cyanjye',
    title: 'The wallet',
    kind: 'LITERACY',
    hours: 1.5,
    sequence: 22,
    summary:
      '"UZA does not hold your money." Setup on their own phone. Seven consecutive daily deposits to pass.',
  },
  {
    code: '2.3',
    titleRw: 'Kwishyura inguzanyo',
    title: 'Servicing the loan',
    kind: 'LITERACY',
    hours: 1.5,
    sequence: 23,
    deliveredByPartner: 'lender',
    summary:
      "Their own schedule, month by month. Delivered by the lender's officer at the branch.",
  },
  {
    code: '2.4',
    titleRw: 'Amategeko atandatu',
    title: 'The six rules of thumb',
    kind: 'BUSINESS',
    hours: 1.5,
    sequence: 24,
    summary:
      'Six rules on cards. No accounting. Passed by teaching all six to a newer participant.',
  },
  {
    code: '2.5',
    titleRw: 'Soma ukwezi kwawe',
    title: 'Reading your own month',
    kind: 'BUSINESS',
    hours: 1.5,
    sequence: 25,
    summary:
      'Own placement data read aloud. The lesson, the assessment and the underwriting evidence at once.',
  },
  {
    code: '2.7',
    titleRw: "Umusanzu n'igihe: icyo bizigama",
    title: 'The ladder and the term: what a bigger stake and three years save',
    kind: 'BUSINESS',
    hours: 1.5,
    sequence: 27,
    summary:
      "The driver's own vehicle through the support-plan what-if: each extra RWF 100,000 of stake, the ladder to 50%, three years against five in RWF per working day and total interest. The right balance is theirs to choose.",
  },
  {
    code: '2.6',
    titleRw: 'Ubwishingizi, ukuri',
    title: 'Insurance, honestly',
    kind: 'LITERACY',
    hours: 1,
    sequence: 26,
    summary:
      'Comprehensive is a lender requirement, not the law. What lapsing does to the loan.',
  },
  // Track 3 — CITY AND CRAFT
  {
    code: '3.1',
    titleRw: 'Ikarita mu ntoki',
    title: 'Google Maps for a driver',
    kind: 'SAFETY',
    hours: 3,
    sequence: 31,
    summary:
      'Four sittings on their own phone. Offline map. Street codes. One real trip by voice.',
  },
  {
    code: '3.2',
    titleRw: 'Ahantu ijana',
    title: 'Knowing your city — the Hundred Places',
    kind: 'SAFETY',
    hours: 2,
    sequence: 32,
    summary:
      'Card set built with the cohort. Oral test on twenty random cards.',
  },
  {
    code: '3.3',
    titleRw: "Imyitwarire y'umushoferi",
    title: 'Conduct refresher',
    kind: 'SAFETY',
    hours: 1.5,
    sequence: 33,
    deliveredByPartner: 'RURA / RNP',
    summary:
      'The Code of Conduct for Drivers. Fares and the meter. What loses a rating.',
  },
  {
    code: '3.4',
    titleRw: "Amategeko y'umuhanda",
    title: 'Road rules and defensive driving, EV edition',
    kind: 'SAFETY',
    hours: 2,
    sequence: 34,
    deliveredByPartner: 'RNP / accredited school',
    summary:
      'Signs refresher. Silent car and pedestrians. Post-collision procedure.',
  },
  // Track 3 — OWN
  {
    code: '4.1',
    titleRw: "Gahunda y'ubucuruzi bwawe",
    title: 'The business plan, from your own twenty weeks',
    kind: 'BUSINESS',
    hours: 3,
    sequence: 41,
    summary:
      'One page, written by the driver from their placement data. Scribes available.',
  },
  {
    code: '4.2',
    titleRw: 'Icyemezo',
    title: 'The decision',
    kind: 'LITERACY',
    hours: 1.5,
    sequence: 42,
    deliveredByPartner: 'lender',
    summary:
      'Borrow, wait, or the Drivers Pool. "Advised not to borrow" is a success outcome and is counted.',
  },
];

/** The six comprehension questions, by code. The recording is the evidence; this is the score. */
export const COMPREHENSION_QUESTIONS = [
  'LIT-Q1',
  'LIT-Q2',
  'LIT-Q3',
  'LIT-Q4',
  'LIT-Q5',
  'LIT-Q6',
] as const;

/** Submission threshold on the readiness engine, and the pass mark on the comprehension test. */
export const COMPREHENSION_PASS_PCT = 70;

export interface AnswerInput {
  questionCode: string;
  correct: boolean;
}

/**
 * A comprehension score is computed from the recorded answers, never typed in. Six questions,
 * each asked once. A trainer who wants to record 83% has to record five correct answers out of
 * six, which is the point.
 */
export function scoreFromAnswers(answers: readonly AnswerInput[]): number {
  const codes = answers.map((a) => a.questionCode);
  const expected = [...COMPREHENSION_QUESTIONS];
  const missing = expected.filter((c) => !codes.includes(c));
  const extra = codes.filter((c) => !(expected as string[]).includes(c));
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (missing.length || extra.length || dupes.length) {
    throw new BadRequestException(
      `A comprehension assessment records exactly the six questions ${expected.join(', ')} once each.` +
        (missing.length ? ` Missing: ${missing.join(', ')}.` : '') +
        (extra.length ? ` Unknown: ${extra.join(', ')}.` : '') +
        (dupes.length ? ` Repeated: ${[...new Set(dupes)].join(', ')}.` : ''),
    );
  }
  const correct = answers.filter((a) => a.correct).length;
  return Math.round((correct / expected.length) * 100);
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * When the next re-test falls due. The first re-test is at day 30 and the second at day 90
 * after the ORIGINAL assessment — comprehension decays, and a score that holds at 90 days
 * is worth more to a lender than one taken the day after the lesson. After the day-90
 * re-test there is no further scheduled re-test.
 */
export function nextRetestDue(
  originalAssessedAt: Date,
  retestNumber: 0 | 1 | 2,
): Date | null {
  if (retestNumber === 0)
    return new Date(originalAssessedAt.getTime() + 30 * DAY);
  if (retestNumber === 1)
    return new Date(originalAssessedAt.getTime() + 90 * DAY);
  return null;
}

export interface AttendanceRow {
  moduleCode: string;
  kind: ModuleKindCode;
  passed: boolean;
  attendedAt: Date;
}

export interface AssessmentRow {
  kind: 'COMPREHENSION' | 'ROAD_CRAFT' | 'EV_CARE';
  scorePct: number;
  assessedAt: Date;
  retestOfId: string | null;
  id: string;
}

export type Trend = 'first' | 'improving' | 'stable' | 'falling';

export interface ReadinessSummary {
  modules: Record<ModuleKindCode, { passed: number; total: number }>;
  modulesPassed: number;
  modulesTotal: number;
  comprehension: {
    latestPct: number | null;
    previousPct: number | null;
    trend: Trend;
    assessedAt: string | null;
    retestsTaken: number;
  };
  /** Every active module passed AND latest comprehension at or above the pass mark. */
  certified: boolean;
  /** Things a reader should notice. A falling comprehension score is one; so is a gate not passed. */
  warnings: string[];
}

/**
 * The summary a lender reads. Built from records, never stored, so it cannot drift from
 * the evidence. Rule from the operating memory: "a falling score is itself a warning" — the
 * day-30 and day-90 re-tests exist to detect exactly that, and a summary that only showed
 * the latest number would hide it.
 */
export function readinessSummary(
  modules: readonly CurriculumModule[],
  attendance: readonly AttendanceRow[],
  assessments: readonly AssessmentRow[],
): ReadinessSummary {
  const kinds: ModuleKindCode[] = ['VEHICLE', 'SAFETY', 'LITERACY', 'BUSINESS'];
  const passedCodes = new Set(
    attendance.filter((a) => a.passed).map((a) => a.moduleCode),
  );
  const byKind = Object.fromEntries(
    kinds.map((k) => {
      const inKind = modules.filter((m) => m.kind === k);
      return [
        k,
        {
          passed: inKind.filter((m) => passedCodes.has(m.code)).length,
          total: inKind.length,
        },
      ];
    }),
  ) as ReadinessSummary['modules'];

  const comp = assessments
    .filter((a) => a.kind === 'COMPREHENSION')
    .sort((a, b) => a.assessedAt.getTime() - b.assessedAt.getTime());
  const latest = comp.at(-1) ?? null;
  const previous = comp.at(-2) ?? null;
  let trend: Trend = 'first';
  if (latest && previous) {
    const d = latest.scorePct - previous.scorePct;
    trend = d > 5 ? 'improving' : d < -5 ? 'falling' : 'stable';
  }

  const warnings: string[] = [];
  if (trend === 'falling' && latest && previous) {
    warnings.push(
      `Comprehension fell from ${previous.scorePct}% to ${latest.scorePct}% on re-test. Coaching before the next instalment is due, not after.`,
    );
  }
  if (!passedCodes.has('1.0')) {
    warnings.push(
      'Module 1.0 (The Jump) not passed: this participant must not be issued a vehicle.',
    );
  }
  if (latest && latest.scorePct < COMPREHENSION_PASS_PCT) {
    warnings.push(
      `Latest comprehension ${latest.scorePct}% is below the ${COMPREHENSION_PASS_PCT}% pass mark.`,
    );
  }

  const modulesPassed = modules.filter((m) => passedCodes.has(m.code)).length;
  return {
    modules: byKind,
    modulesPassed,
    modulesTotal: modules.length,
    comprehension: {
      latestPct: latest?.scorePct ?? null,
      previousPct: previous?.scorePct ?? null,
      trend,
      assessedAt: latest?.assessedAt.toISOString() ?? null,
      retestsTaken: comp.filter((a) => a.retestOfId).length,
    },
    certified:
      modulesPassed === modules.length &&
      latest !== null &&
      latest.scorePct >= COMPREHENSION_PASS_PCT,
    warnings,
  };
}
