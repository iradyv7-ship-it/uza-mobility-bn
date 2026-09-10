-- The equity-gap-closing formula, third turn of it: UZA Empower's collateral tops up a
-- specific candidate's own contribution against a specific loan (not just a bank-wide
-- facility balance), and gives the lender two ongoing data products in exchange --
-- monthly vehicle-condition inspections from a certified mechanic, and daily
-- savings-vs-required-payment tracking. See the workshop and financing modules this
-- migration's tables plug into.

-- CreateEnum
CREATE TYPE "VehicleCondition" AS ENUM ('GOOD', 'FAIR', 'POOR', 'URGENT_ATTENTION');

-- AlterTable
ALTER TABLE "collateral_entries" ADD COLUMN     "loanId" TEXT;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "clientContributionRwf" INTEGER,
ADD COLUMN     "vehiclePriceRwf" INTEGER;

-- CreateTable
CREATE TABLE "vehicle_inspections" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mileageKm" INTEGER,
    "batteryHealthPct" INTEGER,
    "condition" "VehicleCondition" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_savings_entries" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "depositedRwf" INTEGER NOT NULL,
    "requiredDailyRwf" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_savings_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_inspections_loanId_inspectedAt_idx" ON "vehicle_inspections"("loanId", "inspectedAt");

-- CreateIndex
CREATE INDEX "loan_savings_entries_loanId_date_idx" ON "loan_savings_entries"("loanId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "loan_savings_entries_loanId_date_key" ON "loan_savings_entries"("loanId", "date");

-- CreateIndex
CREATE INDEX "collateral_entries_loanId_idx" ON "collateral_entries"("loanId");

-- AddForeignKey
ALTER TABLE "collateral_entries" ADD CONSTRAINT "collateral_entries_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "mechanics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_savings_entries" ADD CONSTRAINT "loan_savings_entries_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

