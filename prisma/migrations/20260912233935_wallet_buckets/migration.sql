-- Wallet buckets: purpose labels on the client's own money, and recorded-vs-confirmed state.
-- See prisma/schema.prisma SECTION 13 and 03-uza-empower/nexus/02-uza-empower-program.md §3.2.

-- CreateEnum
CREATE TYPE "LedgerBucket" AS ENUM ('LOAN', 'MAINTENANCE', 'CHARGING', 'INSURANCE', 'PERSONAL');

-- CreateEnum
CREATE TYPE "LedgerRecordedBy" AS ENUM ('DRIVER', 'STAFF', 'INSTITUTION');

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "bucket" "LedgerBucket",
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedRef" TEXT,
ADD COLUMN     "recordedBy" "LedgerRecordedBy" NOT NULL DEFAULT 'DRIVER';

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "contributionTargetRwf" INTEGER,
ADD COLUMN     "dailyTargetRwf" INTEGER,
ADD COLUMN     "institutionAccountMasked" TEXT,
ADD COLUMN     "institutionName" TEXT,
ADD COLUMN     "splitChargingPct" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "splitInsurancePct" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "splitLoanPct" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "splitMaintenancePct" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "splitPersonalPct" INTEGER NOT NULL DEFAULT 10;

-- CreateIndex
CREATE INDEX "ledger_entries_walletId_bucket_idx" ON "ledger_entries"("walletId", "bucket");
