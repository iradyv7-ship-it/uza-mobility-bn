/**
 * The academy's module catalogue, from nexus `04-training-and-tracks.md` — the three pillars
 * plus the orientation session that opens every cohort. Idempotent: upserts by code, so it can
 * be re-run after the curriculum changes. No personal data.
 *
 *   DATABASE_URL=… npx ts-node scripts/seed-academy-modules.ts
 *
 * Codes: ACD-00 is orientation (the commitment ladder's "showed up" step); ACD-01…07 pillar 1
 * (EV competence), ACD-08…17 pillar 2 (money and the loan), ACD-18…23 pillar 3 (road, safety,
 * professionalism). Modules 2.2 and 2.8 are delivered by the lender's own credit officer — the
 * driver should meet the lender before the lender is a stranger.
 */
import { PrismaClient, type ModuleKind } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const UNGUKA = 'LOLC Unguka Finance';

const MODULES: {
  code: string;
  title: string;
  kind: ModuleKind;
  hours: number;
  summary: string;
  deliveredByPartner?: string;
}[] = [
  { code: 'ACD-00', title: 'Orientation — Intambwe ya mbere', kind: 'LITERACY', hours: 2,
    summary: 'What Twara EV is and is not; the ten weeks; the daily number; Ikigega and the first deposit; the three questions every driver should ask before signing. In Kinyarwanda, in person. Attendance here is rung 2 of the commitment ladder.' },
  // ── Pillar 1 — EV competence ─────────────────────────────────────────────────────────
  { code: 'ACD-01', title: '1.1 What an electric car is', kind: 'VEHICLE', hours: 3, summary: 'Motor vs engine, battery, no gearbox, no oil changes, regenerative braking. Bonnet open. Assessed: point-and-name on a real vehicle.' },
  { code: 'ACD-02', title: '1.2 Charging', kind: 'VEHICLE', hours: 3, summary: 'AC vs DC, home vs public, RWF 110/kWh public tariff (REG, 1 Oct 2025), how long, how much, where. Assessed: a full charge cycle unaided.' },
  { code: 'ACD-03', title: '1.3 Range and the day', kind: 'VEHICLE', hours: 3, summary: 'Reading state of charge, planning a working day, what reduces range, what to do at 15%. Assessed: plan a realistic Kigali working day.' },
  { code: 'ACD-04', title: '1.4 Efficient driving', kind: 'VEHICLE', hours: 4, summary: 'Smooth acceleration, coasting, regen, tyre pressure; the RWF difference over one shift. Assessed: instrumented drive, kWh/100 km measured. Teach the method of measuring — no four-wheel cost-per-km figure is published for Rwanda.' },
  { code: 'ACD-05', title: '1.5 Daily and weekly checks', kind: 'VEHICLE', hours: 2, summary: 'Tyres, brakes, coolant, warning lights, cleanliness. Assessed: the check performed unaided.' },
  { code: 'ACD-06', title: '1.6 Servicing and what not to do', kind: 'VEHICLE', hours: 2, summary: 'Service schedule and cost; never deep-discharge; never an unapproved charger; water and charging; when to stop and call. Assessed: oral scenarios.' },
  { code: 'ACD-07', title: '1.7 Battery health', kind: 'VEHICLE', hours: 2, summary: 'What degrades a battery, what the warranty covers and for how many km, why the maintenance fund exists. Assessed: oral.' },
  // ── Pillar 2 — Money and the loan ────────────────────────────────────────────────────
  { code: 'ACD-08', title: '2.1 What a loan actually is', kind: 'LITERACY', hours: 3, summary: 'Principal, interest, tenor, instalment, arrears, declining balance — with cash and a table, not a formula. Assessed: teach-back.' },
  { code: 'ACD-09', title: '2.2 Reading your own schedule', kind: 'LITERACY', hours: 2, summary: 'The driver’s real schedule for their real target vehicle. Assessed: point to the principal and the interest column.', deliveredByPartner: UNGUKA },
  { code: 'ACD-10', title: '2.3 The daily target', kind: 'LITERACY', hours: 2, summary: 'Monthly instalment ÷ 26 working days; what that is in trips. The number they will live by. Assessed: compute their own, from memory.' },
  { code: 'ACD-11', title: '2.4 The wallet — Ikigega', kind: 'LITERACY', hours: 2, summary: 'Deposit daily into your own account, read the streak, read the progress bar. Assessed: seven consecutive daily deposits.' },
  { code: 'ACD-12', title: '2.5 The four buckets', kind: 'LITERACY', hours: 2, summary: 'Loan · maintenance · charging · insurance. Why the car’s money is not the house’s money. Assessed: allocate a week’s real earnings.' },
  { code: 'ACD-13', title: '2.6 Why contribution is not a formality', kind: 'LITERACY', hours: 2, summary: 'Shown live in Gereranya: below the 10% more of your money reduces UZA’s pledge; above it, every franc lowers the daily figure. Assessed: explain it back.' },
  { code: 'ACD-14', title: '2.7 The car as a business', kind: 'BUSINESS', hours: 3, summary: 'Revenue, cost, profit; recording expenses; what the car earns after everything. Assessed: one week of real records.' },
  { code: 'ACD-15', title: '2.8 When things go wrong', kind: 'LITERACY', hours: 2, summary: 'Sickness, accident, a bad month. Call before you miss, not after. Who to call, what happens, what does not. Assessed: oral scenario.', deliveredByPartner: UNGUKA },
  { code: 'ACD-16', title: '2.9 A simple business plan', kind: 'BUSINESS', hours: 3, summary: 'One page, oral-assisted, scribes available: what I earn, spend, keep, and build toward. Assessed: the page produced.' },
  { code: 'ACD-17', title: '2.10 Insurance, honestly', kind: 'LITERACY', hours: 2, summary: 'What comprehensive covers, what it costs, why the lender requires it (it is not the law — third-party is), what happens if it lapses. Assessed: oral.' },
  // ── Pillar 3 — Road, safety, professionalism ─────────────────────────────────────────
  { code: 'ACD-18', title: '3.1 Signs and rules refresher', kind: 'SAFETY', hours: 3, summary: 'Full refresher, no assumption of retention.' },
  { code: 'ACD-19', title: '3.2 Defensive driving', kind: 'SAFETY', hours: 4, summary: 'Kigali-specific hazards: motos, pedestrians, night, rain. Assessed on road.' },
  { code: 'ACD-20', title: '3.3 EV-specific safety', kind: 'SAFETY', hours: 2, summary: 'Silent operation and pedestrians, high-voltage awareness, post-collision procedure, towing.' },
  { code: 'ACD-21', title: '3.4 Passenger service', kind: 'SAFETY', hours: 2, summary: 'Conduct, pricing honesty, complaints, ratings — what loses a driver their platform rating.' },
  { code: 'ACD-22', title: '3.5 Meter and app compliance', kind: 'SAFETY', hours: 2, summary: 'RURA ICFM requirements; correct use.' },
  { code: 'ACD-23', title: '3.6 Incident procedure', kind: 'SAFETY', hours: 2, summary: 'Accident steps, police, insurer notification, what to photograph, what never to sign.' },
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
  console.log(`academy modules: ${created} created, ${updated} updated, ${MODULES.length} total (${MODULES.reduce((h, m) => h + m.hours, 0)} hours)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
