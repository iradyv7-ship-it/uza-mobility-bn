/**
 * The academy's module catalogue — the curriculum of record is the developed thesis
 * (`03-uza-empower/training/curriculum-thesis.md` §4, 12 Sept 2026): four tracks,
 * Operate → Earn → City and craft → Own, plus the orientation session that opens every cohort.
 * The bilingual phrase-by-phrase script and the trainer's manual follow the same codes.
 *
 * Idempotent: upserts by code; modules no longer in this list are deactivated, never deleted
 * (attendance may point at them). No personal data.
 *
 *   DATABASE_URL=… npx ts-node scripts/seed-academy-modules.ts
 *
 * Codes: ACD-00 orientation (rung 2 of the commitment ladder). ACD-1x Track 1 OPERATE (1.0–1.8,
 * hard gate before any vehicle is issued). ACD-2x Track 2 EARN (2.1–2.8; 2.3 by the lender's
 * officer at the branch). ACD-3x Track 3 CITY AND CRAFT (3.1–3.4; 3.4 with RNP or a school).
 * ACD-4x Track 4 OWN (4.1–4.2; two sessions delivered by the lender).
 */
import { PrismaClient, type ModuleKind } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const UNGUKA = 'LOLC Unguka Finance';
const RNP = 'Rwanda National Police / accredited driving school';

const MODULES: {
  code: string;
  title: string;
  kind: ModuleKind;
  hours: number;
  summary: string;
  deliveredByPartner?: string;
}[] = [
  { code: 'ACD-00', title: 'Orientation — Intambwe ya mbere', kind: 'LITERACY', hours: 2,
    summary: 'What Twara EV is and is not; the ten weeks; the daily number on Gereranya; Ikigega and the first deposit; the three questions to ask before signing. In Kinyarwanda, in person. Attendance is rung 2 of the commitment ladder.' },

  // ── Track 1 — OPERATE (weeks 1–4, ~16 h, hard gate) ───────────────────────────────────
  { code: 'ACD-10', title: '1.0 The Jump — Isimbuka: from a stick to a silent car', kind: 'VEHICLE', hours: 3,
    summary: 'Closed lot, one trainer / two drivers / one car, three 60-minute sessions. The five habits to replace: left foot, hands on the wheel (P-R-N-D), creep then squeeze, lift early and let regen brake, look at the screen not the sound. Assessed: recorded ten-minute lot circuit. No public road until passed.' },
  { code: 'ACD-11', title: '1.1 What an electric car is — Imodoka y’umuriro', kind: 'VEHICLE', hours: 2,
    summary: 'Bonnet open, by a UZA technician: motor, battery (the thing the loan is really buying), inverter and the orange cables, no gearbox/clutch/exhaust, battery cooling loop. Assessed: driver points and names ten items from memory.' },
  { code: 'ACD-12', title: '1.2 Charging — Gushyiramo umuriro', kind: 'VEHICLE', hours: 3,
    summary: 'Connector standard per vehicle and per public site FIRST. AC vs DC, RWF 110/kWh public tariff (REG, 1 Oct 2025), the full-charge arithmetic on the driver’s own phone. The five charging rules. Assessed: a full public-charger session unaided, cost stated before paying.' },
  { code: 'ACD-13', title: '1.3 Range and the day — Umuriro n’urugendo rw’umunsi', kind: 'VEHICLE', hours: 2,
    summary: 'State of charge as a budget. Plan a Kigali working day; what eats range and by how much, shown on the same route twice; regen on the way down. Assessed: plan a day aloud and be right about the evening charge within 10 points.' },
  { code: 'ACD-14', title: '1.4 Efficient driving — Gutwara neza, ukazigama', kind: 'VEHICLE', hours: 3,
    summary: 'Early release, anticipation, smooth acceleration, tyre pressure, climate control. Two laps of the same 8 km loop, normal then coached, kWh/100 km from the car, the RWF difference on the board. Teach the method; no four-wheel figure is published for Rwanda.' },
  { code: 'ACD-15', title: '1.5 Daily and weekly checks — Igenzura rya buri munsi', kind: 'VEHICLE', hours: 1.5,
    summary: 'A laminated picture card in the door pocket. Daily: tyres, lights, wipers, charge-port door, warning lights, cabin. Weekly: pressures, washer fluid, brake feel, 12-volt terminals, odometer and charge photo to the wallet. Assessed: performed unaided, trainer silent.' },
  { code: 'ACD-16', title: '1.6 Servicing and the monthly inspection — Garage n’isuzuma rya buri kwezi', kind: 'VEHICLE', hours: 1.5,
    summary: 'Service schedule and cost; what voids the warranty (unapproved chargers, roadside hands on the orange cables). The monthly certified-garage inspection: filed against the UZA ID, visible to the lender like an instalment. Taught as owning the car, not compliance.' },
  { code: 'ACD-17', title: '1.7 Battery health — Ubuzima bwa batiri', kind: 'VEHICLE', hours: 1,
    summary: 'The battery ages ~2.3% a year and the driver controls about half of it: fast-charging habit, heat, time at 0% or 100%. Warranty terms per model (to confirm). Why the maintenance bucket exists. Frame: every fast charge skipped is money kept at resale.' },
  { code: 'ACD-18', title: '1.8 Living with it — Kubana n’imodoka yawe', kind: 'VEHICLE', hours: 1,
    summary: 'Rain and flood spots, washing (never a jet at the charge port), warning symbols on a card, towing never with drive wheels down, the 12-volt is nearly always why it will not start — where it is and who to call.' },

  // ── Track 2 — EARN (weeks 5–24, 90 min weekly, groups of 8–12, own data) ──────────────
  { code: 'ACD-21', title: '2.1 The daily target — Intego ya buri munsi', kind: 'LITERACY', hours: 1.5,
    summary: 'Monthly instalment ÷ working days, in the driver’s own numbers for their own car at the tenor they chose; then in trips. Computed by the driver, every week, until it is reflex. Opens every Track 2 session.' },
  { code: 'ACD-22', title: '2.2 The wallet — Ikigega cyanjye', kind: 'LITERACY', hours: 1.5,
    summary: 'UZA does not hold your money — said in the first minute, repeated until said back. Setup on the driver’s own phone, four buckets, first deposit in the session, the streak. Call-before-you-miss button. Assessed: seven consecutive daily deposits — the wallet record itself.' },
  { code: 'ACD-23', title: '2.3 Servicing the loan — Kwishyura inguzanyo (at the branch)', kind: 'LITERACY', hours: 1.5,
    summary: 'This driver’s own schedule month by month; where the interest is highest and why early extra matters; a missed instalment in RWF per day and in trips; arrears, restructure, repossession and how far away it is if you called. Delivered by the lender’s officer at the branch.', deliveredByPartner: UNGUKA },
  { code: 'ACD-24', title: '2.4 The six rules — Amabwiriza atandatu', kind: 'LITERACY', hours: 1.5,
    summary: 'Pay the car before you pay yourself · Two purses · The bad-week rule · The maintenance bucket is not savings · Charging money is fuel money · Call before you miss. One card and one audio each. Assessed: the driver teaches all six to a newer member, unprompted.' },
  { code: 'ACD-25', title: '2.5 Reading your own month — Soma ukwezi kwawe', kind: 'LITERACY', hours: 1.5,
    summary: 'From week 8: the driver’s own placement data read aloud — days, gross, charging, net, streak; the group asks about the low week. The literacy lesson, the comprehension assessment and the underwriting evidence at once.' },
  { code: 'ACD-26', title: '2.6 Insurance, honestly — Ubwishingizi, ukuri', kind: 'LITERACY', hours: 1,
    summary: 'Comprehensive is the lender’s requirement, not the law (third-party is). What it costs, what it covers, what lapsing does to the loan, why the premium has its own bucket.' },
  { code: 'ACD-27', title: '2.7 The ladder and the term — Umusanzu n’igihe', kind: 'LITERACY', hours: 1.5,
    summary: 'From the driver’s own vehicle on Gereranya: below the bank’s 10% more of your money only reduces UZA’s pledge; above it every franc lowers the daily figure; three years vs five in francs a day and total interest. What is deliberately not said: "you should". Assessed: explained unprompted to a newer participant.' },
  { code: 'ACD-28', title: '2.8 When things go wrong — Igihe ibintu bigenze nabi', kind: 'LITERACY', hours: 1,
    summary: 'Sickness, accident, a bad month. Call before you miss, not after; who answers, what happens, what does not. Assessed: oral scenario.', deliveredByPartner: UNGUKA },

  // ── Track 3 — CITY AND CRAFT (weeks 2–8 alongside Track 1, then continuous) ───────────
  { code: 'ACD-31', title: '3.1 Maps for a driver — Ikarita mu ntoki', kind: 'BUSINESS', hours: 3,
    summary: 'On the driver’s own phone, four 45-minute sittings in pairs: the map is your city (KN/KG/KK codes); directions and the blue line (voice in Kinyarwanda); offline and traffic; saving your working city and sharing live location. Assessed: real trips by voice, one with data off; 25 saved places.' },
  { code: 'ACD-32', title: '3.2 The Hundred Places — Ahantu ijana', kind: 'BUSINESS', hours: 2,
    summary: 'A hundred destinations a passenger is most likely to name, each card with name, district code, entrance photo, nearest charger. Learned in pairs; built with the first cohort’s own knowledge. Assessed: oral, 20 random cards.' },
  { code: 'ACD-33', title: '3.3 Conduct — Imyitwarire y’umushoferi', kind: 'SAFETY', hours: 2,
    summary: 'From the RURA Code of Conduct (official text to obtain): passenger treatment, the driver card, fines; fares and the ICFM meter; what loses a platform rating; complaint handling — what to say, what never to say, when to end a trip.' },
  { code: 'ACD-34', title: '3.4 Road rules, EV edition — Amategeko y’umuhanda', kind: 'SAFETY', hours: 4,
    summary: 'Signs and rules refresher; Kigali hazards; EV-specific: pedestrians cannot hear you, the car is quicker than anything around it, after a collision switch off and never touch orange cables, tell the tow operator it is electric. With RNP or an accredited school; seek RNP co-branding.', deliveredByPartner: RNP },

  // ── Track 4 — OWN and AFTERCARE (weeks 20–26, then months 1/3/6/12) ───────────────────
  { code: 'ACD-41', title: '4.1 The business plan — Gahunda y’ubucuruzi bwawe', kind: 'BUSINESS', hours: 2,
    summary: 'One page from the driver’s own twenty weeks of placement data: what I earn, spend, keep, and build toward. Oral-assisted; scribes available. Two sessions delivered by the lender.', deliveredByPartner: UNGUKA },
  { code: 'ACD-42', title: '4.2 The decision — Icyemezo', kind: 'BUSINESS', hours: 1.5,
    summary: 'Whether to take this loan, on this car, at this term — including the honest outcome that the answer is not yet, and the Drivers Pool as a real success. The comprehension assessment sits here. Month-3 aftercare follows: the coaching session that saves loans.' },
];

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  let created = 0, updated = 0;
  for (const [i, m] of MODULES.entries()) {
    const existing = await prisma.academyModule.findUnique({ where: { code: m.code } });
    const data = { title: m.title, kind: m.kind, hours: m.hours, sequence: i, summary: m.summary, deliveredByPartner: m.deliveredByPartner ?? null, isActive: true };
    if (existing) { await prisma.academyModule.update({ where: { code: m.code }, data }); updated++; }
    else { await prisma.academyModule.create({ data: { code: m.code, ...data } }); created++; }
  }
  const codes = MODULES.map((m) => m.code);
  const retired = await prisma.academyModule.updateMany({ where: { code: { notIn: codes }, isActive: true }, data: { isActive: false } });
  console.log(`academy modules: ${created} created, ${updated} updated, ${retired.count} retired; ${MODULES.length} active (${MODULES.reduce((h, m) => h + m.hours, 0)} hours)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
