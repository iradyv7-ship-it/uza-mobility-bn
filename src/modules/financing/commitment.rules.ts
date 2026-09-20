/**
 * The commitment ladder — how UZA tells a serious client from a curious one without
 * scoring anybody.
 *
 * Yves, 20 September 2026: "clients can browse … guidance to filter out unserious clients."
 *
 * The premise of the programme (fund-application.rules.ts) is gaps, not scores: a driver is
 * undocumented, not unbankable. So seriousness is not judged from what someone says or who
 * they are. It is *demonstrated*, step by step, by things that cost the driver effort and
 * cost UZA nothing — and UZA's scarce staff time is released one rung at a time:
 *
 *   0  BROWSING     Signed in (Google is fine). Can compare cars, banks, years; can read.
 *                   Costs UZA nothing. No staff contact.
 *   1  INTERESTED   Verified phone or email, picked a car, declared income and district.
 *                   Still no staff time: an automated message with the orientation dates.
 *   2  SHOWED_UP    Attended orientation (a module attendance with a trainer's signature)
 *                   AND opened Ikigega and recorded a first deposit into their own account.
 *                   First staff conversation happens here — after they came, not before.
 *   3  PROVING      Twenty working days with deposits (the streak), documents complete
 *                   (ID, licence), comprehension assessment passed. Intake officer time.
 *   4  READY        The banded client minimum reached (own savings + earned credits) and
 *                   the fund application signed. Now, and only now, a lender's time.
 *
 * Every rung says what the next step is, in words a driver can act on. Nobody is told they
 * failed; they are told what is left. A client who stops climbing simply stays where they
 * are, and staff lists sort by rung so the people who did the work are seen first.
 *
 * Kinyarwanda strings are proposals pending native review (nexus D0v).
 */

export type CommitmentStage =
  | 'BROWSING'
  | 'INTERESTED'
  | 'SHOWED_UP'
  | 'PROVING'
  | 'READY';

export const STAGE_ORDER: readonly CommitmentStage[] = [
  'BROWSING',
  'INTERESTED',
  'SHOWED_UP',
  'PROVING',
  'READY',
];

/** Working days with a deposit that count as "proving". Four weeks of six days. */
export const PROVING_STREAK_DAYS = 20;

export interface CommitmentSignals {
  emailVerified: boolean;
  phoneVerified: boolean;
  /** A chosen vehicle/price, from the compare page or an interest lead. */
  hasChosenVehicle: boolean;
  declaredIncome: boolean;
  /** Attended the orientation module with a trainer's record. */
  attendedOrientation: boolean;
  walletOpened: boolean;
  /** Confirmed deposits into the driver's own account, ever. */
  confirmedDeposits: number;
  /** Consecutive working days with a confirmed deposit (wallet Performance.currentStreak). */
  currentStreak: number;
  longestStreak: number;
  documentsComplete: boolean; // national ID + licence recorded
  comprehensionPassed: boolean;
  /** Own confirmed savings + credits, vs the banded minimum for the chosen price. */
  contributionTotalRwf: number;
  clientMinimumRwf: number | null;
  fundApplicationSigned: boolean;
}

export interface NextStep {
  code: string;
  en: string;
  rw: string;
}

export interface Commitment {
  stage: CommitmentStage;
  /** 0–4, for sorting. */
  rung: number;
  /** What was demonstrated, in order. */
  evidence: string[];
  /** The one thing to do next. Empty at READY. */
  next: NextStep | null;
  /** Whether a staff member should spend time on this person yet. */
  staffTime: 'none' | 'automated' | 'first-conversation' | 'intake-officer' | 'lender';
}

const NEXT: Record<string, NextStep> = {
  VERIFY_CONTACT: {
    code: 'VERIFY_CONTACT',
    en: 'Verify your phone number or email so we can reach you.',
    rw: 'Emeza nimero ya telefoni cyangwa imeyili yawe kugira ngo tubashe kukugeraho.',
  },
  CHOOSE_VEHICLE: {
    code: 'CHOOSE_VEHICLE',
    en: 'Choose the car and the years on the Compare page — it takes a minute.',
    rw: 'Hitamo imodoka n’imyaka ku ipaji ya Gereranya — bifata umunota.',
  },
  DECLARE_INCOME: {
    code: 'DECLARE_INCOME',
    en: 'Tell us your usual daily takings and working days.',
    rw: 'Tubwire amafaranga winjiza ku munsi n’iminsi ukora mu cyumweru.',
  },
  ATTEND_ORIENTATION: {
    code: 'ATTEND_ORIENTATION',
    en: 'Come to the next orientation session (in Kinyarwanda, two hours). Dates are in your notifications.',
    rw: 'Uze mu isomo ry’ibanze rikurikira (mu Kinyarwanda, amasaha abiri). Amatariki ari mu butumwa bwawe.',
  },
  OPEN_WALLET_AND_DEPOSIT: {
    code: 'OPEN_WALLET_AND_DEPOSIT',
    en: 'Open Ikigega and record your first deposit into your own account — any amount.',
    rw: 'Fungura Ikigega maze wandike ubwizigame bwa mbere kuri konti yawe bwite — umubare uwo ari wo wose.',
  },
  KEEP_THE_STREAK: {
    code: 'KEEP_THE_STREAK',
    en: `Deposit on ${PROVING_STREAK_DAYS} working days in a row. Your streak is the strongest thing in your file.`,
    rw: `Bitsa ku minsi y’akazi ${PROVING_STREAK_DAYS} ikurikiranye. Uruhererekane rwawe ni cyo kintu gikomeye kurusha ibindi muri dosiye yawe.`,
  },
  COMPLETE_DOCUMENTS: {
    code: 'COMPLETE_DOCUMENTS',
    en: 'Bring your national ID and driving licence so we can record them.',
    rw: 'Zana indangamuntu n’uruhushya rwo gutwara kugira ngo tubyandike.',
  },
  PASS_COMPREHENSION: {
    code: 'PASS_COMPREHENSION',
    en: 'Sit the six loan questions with a trainer. They are asked aloud in Kinyarwanda.',
    rw: 'Subiza ibibazo bitandatu by’inguzanyo n’umutoza. Bibazwa mu majwi mu Kinyarwanda.',
  },
  REACH_MINIMUM: {
    code: 'REACH_MINIMUM',
    en: 'Reach the client minimum for your car. Your savings and any earned credit both count.',
    rw: 'Gera ku ntarengwa isabwa ku modoka yawe. Ubwizigame bwawe n’inguzanyo winjije byose bibarwa.',
  },
  SIGN_APPLICATION: {
    code: 'SIGN_APPLICATION',
    en: 'Sign your fund application with an intake officer.',
    rw: 'Shyira umukono ku busabe bwawe bw’inkunga hamwe n’umukozi w’iyakira.',
  },
};

export function commitment(s: CommitmentSignals): Commitment {
  const evidence: string[] = [];
  const done = (t: string) => evidence.push(t);

  // ── Rung 1: interested ────────────────────────────────────────────────────────────────
  const contactOk = s.emailVerified || s.phoneVerified;
  if (contactOk) done(s.phoneVerified ? 'Phone verified' : 'Email verified');
  if (s.hasChosenVehicle) done('Chose a vehicle');
  if (s.declaredIncome) done('Declared income');
  if (!contactOk) return out('BROWSING', evidence, NEXT.VERIFY_CONTACT, 'none');
  if (!s.hasChosenVehicle) return out('BROWSING', evidence, NEXT.CHOOSE_VEHICLE, 'none');
  if (!s.declaredIncome) return out('BROWSING', evidence, NEXT.DECLARE_INCOME, 'none');

  // ── Rung 2: showed up ─────────────────────────────────────────────────────────────────
  if (s.attendedOrientation) done('Attended orientation');
  const firstDeposit = s.walletOpened && s.confirmedDeposits > 0;
  if (s.walletOpened) done('Opened Ikigega');
  if (firstDeposit) done('First deposit confirmed');
  if (!s.attendedOrientation) return out('INTERESTED', evidence, NEXT.ATTEND_ORIENTATION, 'automated');
  if (!firstDeposit) return out('INTERESTED', evidence, NEXT.OPEN_WALLET_AND_DEPOSIT, 'automated');

  // ── Rung 3: proving ───────────────────────────────────────────────────────────────────
  const streakOk = Math.max(s.currentStreak, s.longestStreak) >= PROVING_STREAK_DAYS;
  if (streakOk) done(`${PROVING_STREAK_DAYS}-day deposit streak`);
  if (s.documentsComplete) done('Documents complete');
  if (s.comprehensionPassed) done('Comprehension passed');
  if (!streakOk) return out('SHOWED_UP', evidence, NEXT.KEEP_THE_STREAK, 'first-conversation');
  if (!s.documentsComplete) return out('SHOWED_UP', evidence, NEXT.COMPLETE_DOCUMENTS, 'first-conversation');
  if (!s.comprehensionPassed) return out('SHOWED_UP', evidence, NEXT.PASS_COMPREHENSION, 'first-conversation');

  // ── Rung 4: ready ─────────────────────────────────────────────────────────────────────
  const minimumOk = s.clientMinimumRwf !== null && s.contributionTotalRwf >= s.clientMinimumRwf;
  if (minimumOk) done('Client minimum reached');
  if (s.fundApplicationSigned) done('Fund application signed');
  if (!minimumOk) return out('PROVING', evidence, NEXT.REACH_MINIMUM, 'intake-officer');
  if (!s.fundApplicationSigned) return out('PROVING', evidence, NEXT.SIGN_APPLICATION, 'intake-officer');

  return out('READY', evidence, null, 'lender');
}

function out(
  stage: CommitmentStage,
  evidence: string[],
  next: NextStep | null,
  staffTime: Commitment['staffTime'],
): Commitment {
  return { stage, rung: STAGE_ORDER.indexOf(stage), evidence, next, staffTime };
}
