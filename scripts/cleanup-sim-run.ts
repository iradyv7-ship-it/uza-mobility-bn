/**
 * Surgical cleanup between simulation re-runs: deletes only the rows this specific
 * script's accounts would create (by email pattern), rather than resetting the whole
 * database. Safe to run against the isolated twara_sim database only — refuses to run
 * unless DATABASE_URL clearly points at it.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl.includes('twara_sim')) {
  console.error('Refusing to run: DATABASE_URL does not look like the isolated twara_sim database.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });

async function main() {
  const emailPatterns = [
    'scorah@uza.rw',
    'paulin@unguka.rw',
    'mechanic1@uza.rw',
  ];

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { in: emailPatterns } },
        { email: { endsWith: '@drivers.uzaempower.rw' } },
      ],
    },
    select: { id: true, email: true },
  });

  if (users.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  const userIds = users.map((u) => u.id);
  console.log(`Cleaning up ${users.length} test account(s):`, users.map((u) => u.email).join(', '));

  const loans = await prisma.loan.findMany({ where: { borrowerUserId: { in: userIds } }, select: { id: true } });
  const loanIds = loans.map((l) => l.id);

  if (loanIds.length > 0) {
    await prisma.loanChangeRequest.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.loanTenorChange.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.loanVehicle.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.vehicleInspection.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.loanSavingsEntry.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.lenderDecision.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.infoRequest.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.creditNote.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.collateralEntry.deleteMany({ where: { loanId: { in: loanIds } } });
    await prisma.loan.deleteMany({ where: { id: { in: loanIds } } });
  }

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: userIds } } } }).catch(() => {});
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.financingRequest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log('Cleanup complete.');
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
