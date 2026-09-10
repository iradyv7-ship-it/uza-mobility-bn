-- CreateEnum
CREATE TYPE "FundApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SCREENING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VehicleRelationship" AS ENUM ('OWNS', 'RENTS', 'DRIVES_FOR_EMPLOYER', 'NONE');

-- CreateEnum
CREATE TYPE "SavingsLocation" AS ENUM ('BANK', 'SACCO', 'MOBILE_MONEY', 'CASH_AT_HOME', 'NONE');

-- CreateEnum
CREATE TYPE "FormCompletionMode" AS ENUM ('SELF_SERVICE', 'ASSISTED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'PREFER_NOT_TO_SAY');

-- CreateTable
CREATE TABLE "fund_applications" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "uzaId" TEXT,
    "status" "FundApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "fullName" TEXT NOT NULL,
    "nationalId" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "district" TEXT NOT NULL,
    "sector" TEXT,
    "cell" TEXT,
    "licenceNumber" TEXT,
    "licenceCategory" TEXT,
    "licenceExpiry" DATE,
    "yearsDriving" INTEGER,
    "currentVehicle" "VehicleRelationship",
    "currentPlate" TEXT,
    "associationName" TEXT,
    "averageDailyTakingsRwf" INTEGER,
    "workingDaysPerWeek" INTEGER,
    "currentDailyRentalRwf" INTEGER,
    "otherMonthlyIncomeRwf" INTEGER,
    "dependants" INTEGER,
    "currentSavingsRwf" INTEGER,
    "savingsHeldAt" "SavingsLocation",
    "monthlySavingCapacityRwf" INTEGER,
    "hasBankAccount" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "mobileMoneyNumber" TEXT,
    "hasBorrowedBefore" BOOLEAN NOT NULL DEFAULT false,
    "currentlyRepayingLoan" BOOLEAN NOT NULL DEFAULT false,
    "currentLoanDetail" TEXT,
    "cohortId" TEXT,
    "preferredTenorMonths" INTEGER,
    "depositAvailableRwf" INTEGER,
    "preferredLenderKey" TEXT,
    "declarationAccepted" BOOLEAN NOT NULL DEFAULT false,
    "lenderConsentGiven" BOOLEAN NOT NULL DEFAULT false,
    "dataProcessingConsentGiven" BOOLEAN NOT NULL DEFAULT false,
    "completionMode" "FormCompletionMode" NOT NULL DEFAULT 'SELF_SERVICE',
    "assistedByRef" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureRef" TEXT,
    "witnessName" TEXT,
    "witnessRef" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fund_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fund_applications_ref_key" ON "fund_applications"("ref");

-- CreateIndex
CREATE INDEX "fund_applications_status_idx" ON "fund_applications"("status");

-- CreateIndex
CREATE INDEX "fund_applications_uzaId_idx" ON "fund_applications"("uzaId");

-- CreateIndex
CREATE INDEX "fund_applications_cohortId_idx" ON "fund_applications"("cohortId");

-- CreateIndex
CREATE INDEX "fund_applications_nationalId_idx" ON "fund_applications"("nationalId");

-- AddForeignKey
ALTER TABLE "fund_applications" ADD CONSTRAINT "fund_applications_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
