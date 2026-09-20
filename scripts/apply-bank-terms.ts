/**
 * Book the terms a bank actually agreed on a loan, when they differ from "price minus
 * contribution": a fixed disbursement, a client minimum, and UZA's balance as cash collateral.
 *
 * First use — Unguka, 20 September 2026, Gisele Tuyisenge (LOAN-2026-000001): the analyst
 * wanted to hold the vehicle at 21M; Yves refused; the conclusion was price 22.5M, client
 * 1M, bank 21.75M fixed, UZA 1.25M pledged as cash collateral. Charité is the stated exception
 * and keeps her proforma terms.
 *
 *   DATABASE_URL=… npx ts-node scripts/apply-bank-terms.ts LOAN-2026-000001 22500000 1000000 21750000 1250000 "note"
 *
 * Only an undisbursed loan is re-quoted. The re-quote uses the same maths as origination.
 *
 * SUPERSEDED 20 Sept 2026 by the scenario engine: `POST /admin/loans/:loanId/scenario/apply`
 * (scenario.service.ts) does the same booking from the panel, with the rule checks and an
 * audit line with before/after. Kept for the record of how batch 1 was booked.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { quoteLoan, UNGUKA_RATE_BANDS } from '../src/modules/financing/loan-terms';

async function main() {
  const [ref, priceS, clientS, loanS, collateralS, ...noteParts] = process.argv.slice(2);
  if (!ref || !priceS || !clientS || !loanS || !collateralS) {
    throw new Error('usage: <loanRef> <priceRwf> <clientRwf> <loanRwf> <uzaCollateralRwf> [note]');
  }
  const price = Number(priceS), client = Number(clientS), financed = Number(loanS), collateral = Number(collateralS);
  const note = noteParts.join(' ');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  const loan = await prisma.loan.findUnique({ where: { reference: ref } });
  if (!loan) throw new Error(`no loan ${ref}`);
  if (loan.disbursedAt) throw new Error(`${ref} is disbursed; the schedule is the bank's now`);

  const q = quoteLoan(financed, loan.tenorMonths, UNGUKA_RATE_BANDS);
  const fundsVsPrice = client + financed - price; // > 0 means the bank finances above price − contribution

  await prisma.$transaction(async (tx) => {
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        vehiclePriceRwf: price,
        clientContributionRwf: client,
        principalRwf: q.financedRwf,
        annualRateBps: q.annualRateBps,
        monthlyRwf: q.monthlyRwf,
        dailyRwf: q.dailyRwf,
        totalRepayableRwf: q.totalRepayableRwf,
        outstandingRwf: q.financedRwf,
      },
    });
    // UZA's cash collateral behind this loan — a pledge with a release test (nexus 03), never
    // a guarantee. Idempotent: one PLEDGED entry per loan from this script.
    const existing = await tx.collateralEntry.findFirst({
      where: { loanId: loan.id, kind: 'PLEDGED', note: { startsWith: 'Bank terms' } },
    });
    if (existing) {
      await tx.collateralEntry.update({ where: { id: existing.id }, data: { amountRwf: collateral } });
    } else {
      await tx.collateralEntry.create({
        data: {
          bankId: loan.bankId,
          loanId: loan.id,
          kind: 'PLEDGED',
          amountRwf: collateral,
          note: `Bank terms agreed ${new Date().toISOString().slice(0, 10)}: client ${client.toLocaleString('en-RW')} + UZA cash collateral ${collateral.toLocaleString('en-RW')} = ${((client + collateral) / price * 100).toFixed(1)}% of ${price.toLocaleString('en-RW')}`,
        },
      });
    }
    await tx.wallet.updateMany({
      where: { userId: loan.borrowerUserId },
      data: { dailyTargetRwf: q.dailyRwf, contributionTargetRwf: client },
    });
    await tx.activityLog.create({
      data: {
        action: 'BANK_TERMS_AGREED',
        entity: 'loan',
        entityId: loan.id,
        metadata: {
          reference: ref,
          priceRwf: price,
          clientContributionRwf: client,
          loanRwf: financed,
          uzaCollateralRwf: collateral,
          tenPercentOfPrice: Math.round(price * 0.1),
          coveredByClientPlusUza: client + collateral,
          fundsAbovePriceRwf: fundsVsPrice,
          dailyRwf: q.dailyRwf,
          monthlyRwf: q.monthlyRwf,
          totalRepayableRwf: q.totalRepayableRwf,
          note,
        },
      },
    });
  });

  console.log(
    `${ref}: price ${price}, client ${client}, loan ${financed}, UZA collateral ${collateral}; ` +
      `monthly ${q.monthlyRwf}, daily ${q.dailyRwf}, total ${q.totalRepayableRwf}; ` +
      `funds above price: ${fundsVsPrice}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
