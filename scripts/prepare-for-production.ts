/**
 * The last thing run on a database before real people use it.
 *
 *   1. Deletes the servicing test loan (LOAN-2026-000017) and its test borrower, with every
 *      row that hangs off them (repayments, ledger lines, wallet, collateral, activity).
 *   2. Invalidates every simulation password. Named accounts (real people who were given
 *      `Twara-sim-2026!` during the simulation) get a random password they do not know and
 *      `mustChangePassword`, so their first real sign-in goes through "Forgot password" —
 *      which means MAIL must be on. The seed admin is included.
 *   3. Prints what it did. Nothing else.
 *
 * Refuses to run unless CONFIRM_PREPARE=yes. Idempotent: a second run finds nothing to do.
 *
 *   DATABASE_URL=… CONFIRM_PREPARE=yes npx ts-node scripts/prepare-for-production.ts
 */
import { randomBytes } from 'node:crypto';
import { genSaltSync, hashSync } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const TEST_LOAN_REFS = ['LOAN-2026-000017'];
const TEST_USER_EMAILS = ['test.servicing@uza.local'];
/** Real accounts that carried a simulation password. */
const SIMULATION_PASSWORD_ACCOUNTS = [
  'admin@uza.rw',
  'scorah@uza.rw',
  'paulin@unguka.rw',
  'gisele.tuyisenge.1@drivers.uzaempower.rw',
  'charite.cyubahiro.2@drivers.uzaempower.rw',
];

// Same scheme as AuthService.hashPassword (bcrypt, cost 10) so the row stays valid.
function hashPassword(password: string): string {
  return hashSync(password, genSaltSync(10));
}

async function main() {
  if (process.env.CONFIRM_PREPARE !== 'yes') {
    throw new Error('Refusing: set CONFIRM_PREPARE=yes to run this against the database.');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const done: string[] = [];

  // 1. Test loans and their borrowers.
  for (const ref of TEST_LOAN_REFS) {
    const loan = await prisma.loan.findUnique({ where: { reference: ref } });
    if (!loan) {
      done.push(`${ref}: already gone`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.loanRepayment.deleteMany({ where: { loanId: loan.id } });
      await tx.collateralEntry.deleteMany({ where: { loanId: loan.id } });
      await tx.loanSavingsEntry.deleteMany({ where: { loanId: loan.id } });
      await tx.loanTenorChange.deleteMany({ where: { loanId: loan.id } });
      await tx.loanChangeRequest.deleteMany({ where: { loanId: loan.id } });
      await tx.loanComfortLetter.deleteMany({ where: { loanId: loan.id } });
      await tx.loanVehicle.deleteMany({ where: { loanId: loan.id } });
      await tx.activityLog.deleteMany({ where: { entityId: loan.id } });
      await tx.loan.delete({ where: { id: loan.id } });
    });
    done.push(`${ref}: deleted with its repayments, collateral, vehicle and activity`);
  }

  for (const email of TEST_USER_EMAILS) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) {
      done.push(`${email}: already gone`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: u.id } });
      if (wallet) {
        await tx.ledgerEntry.deleteMany({ where: { walletId: wallet.id } });
        await tx.wallet.delete({ where: { id: wallet.id } });
      }
      await tx.contributionCredit.deleteMany({ where: { userId: u.id } });
      await tx.notification.deleteMany({ where: { userId: u.id } });
      await tx.activityLog.deleteMany({ where: { OR: [{ userId: u.id }, { entityId: u.id }] } });
      await tx.user.delete({ where: { id: u.id } });
    });
    done.push(`${email}: deleted with wallet, ledger, credits, notifications`);
  }

  // 2. Simulation passwords.
  for (const email of SIMULATION_PASSWORD_ACCOUNTS) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, mustChangePassword: true } });
    if (!u) {
      done.push(`${email}: no such account`);
      continue;
    }
    if (u.mustChangePassword) {
      done.push(`${email}: already invalidated`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordHash: hashPassword(randomBytes(32).toString('hex')),
        mustChangePassword: true,
      },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: u.id } });
    done.push(`${email}: password invalidated, sessions revoked — first sign-in via Forgot password`);
  }

  console.log(done.join('\n'));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
