/**
 * Apply the 16 Kinyarwanda proformas (PI-UZA-2026-012 … 027, dated 15 Sept 2026) to the
 * batch-1 loans: vehicle price, chassis, and the re-quoted schedule where the price changed.
 *
 * The proforma is UZA Mobility's own commercial document to the client, so it is the record
 * for vehicle identity and price; the bank's tracking sheet was not. Only loans that have not
 * been disbursed are touched — a disbursed loan's schedule is the bank's, not ours to re-quote.
 *
 * Personal data never enters the repository: the proforma facts come from a JSON file
 * supplied at runtime (PROFORMAS_JSON), extracted from the PDF outside git.
 *
 *   DATABASE_URL=… PROFORMAS_JSON=/secure/path/proformas.json npx ts-node scripts/apply-proformas-batch1.ts
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { quoteLoan } from '../src/modules/financing/loan-terms';
import { UNGUKA_RATE_BANDS } from '../src/modules/financing/loan-terms';

interface Proforma {
  pi: string;
  chassis: string;
  total: string; // "22,000,000.00"
  contrib: string;
  loan: string;
  year: string;
  km: string;
  date: string;
  /** Loan reference this proforma belongs to — mapped outside git, by row order. */
  loanRef: string;
}

const rwf = (s: string) => Math.round(Number(s.replace(/[,\s]/g, '')));

async function main() {
  const path = process.env.PROFORMAS_JSON;
  if (!path) throw new Error('PROFORMAS_JSON is required; the proformas are personal data and are not in the repository.');
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Proforma[];
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const changes: string[] = [];
  for (const p of rows) {
    const loan = await prisma.loan.findUnique({
      where: { reference: p.loanRef },
      include: { vehicle: true },
    });
    if (!loan) {
      changes.push(`${p.pi}: no loan ${p.loanRef}`);
      continue;
    }
    if (loan.disbursedAt) {
      changes.push(`${p.pi}: ${p.loanRef} is disbursed — not re-quoted`);
      continue;
    }
    const price = rwf(p.total);
    const contrib = rwf(p.contrib);
    const data: Record<string, unknown> = {};
    const notes: string[] = [];
    if (loan.vehiclePriceRwf !== price || loan.clientContributionRwf !== contrib) {
      const q = quoteLoan(price - contrib, loan.tenorMonths, UNGUKA_RATE_BANDS);
      Object.assign(data, {
        vehiclePriceRwf: price,
        clientContributionRwf: contrib,
        principalRwf: q.financedRwf,
        annualRateBps: q.annualRateBps,
        monthlyRwf: q.monthlyRwf,
        dailyRwf: q.dailyRwf,
        totalRepayableRwf: q.totalRepayableRwf,
        outstandingRwf: q.financedRwf,
      });
      notes.push(`price ${loan.vehiclePriceRwf}→${price}, contrib ${loan.clientContributionRwf}→${contrib}, principal ${loan.principalRwf}→${q.financedRwf}, daily ${loan.dailyRwf}→${q.dailyRwf}`);
    }
    if (p.chassis && loan.vehicle && loan.vehicle.chassisNumber !== p.chassis) {
      await prisma.loanVehicle.update({
        where: { id: loan.vehicle.id },
        data: { chassisNumber: p.chassis, year: p.year ? Number(p.year) : loan.vehicle.year },
      });
      notes.push(`chassis ${loan.vehicle.chassisNumber}→${p.chassis}`);
    }
    if (Object.keys(data).length) await prisma.loan.update({ where: { id: loan.id }, data });
    await prisma.activityLog.create({
      data: {
        action: 'BATCH1_PROFORMA_APPLIED',
        entity: 'loan',
        entityId: loan.id,
        metadata: { proforma: p.pi, proformaDate: p.date, changes: notes, source: 'ALL 16 Proformas - Kinyarwanda.pdf' },
      },
    });
    changes.push(`${p.pi} → ${p.loanRef}: ${notes.length ? notes.join('; ') : 'already matches'}`);
  }
  console.log(changes.join('\n'));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
