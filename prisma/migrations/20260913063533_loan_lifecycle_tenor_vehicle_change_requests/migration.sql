-- CreateEnum
CREATE TYPE "LoanChangeType" AS ENUM ('TENOR', 'CONTRIBUTION', 'VEHICLE_PRICE');

-- CreateEnum
CREATE TYPE "LoanChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_ASSIGNED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "loan_vehicles" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "plate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_tenor_changes" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "fromTenorMonths" INTEGER NOT NULL,
    "toTenorMonths" INTEGER NOT NULL,
    "fromMonthlyRwf" INTEGER NOT NULL,
    "toMonthlyRwf" INTEGER NOT NULL,
    "fromDailyRwf" INTEGER NOT NULL,
    "toDailyRwf" INTEGER NOT NULL,
    "reason" TEXT,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_tenor_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_change_requests" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "changeType" "LoanChangeType" NOT NULL,
    "payload" JSONB NOT NULL,
    "note" TEXT,
    "status" "LoanChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_vehicles_loanId_key" ON "loan_vehicles"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_vehicles_chassisNumber_key" ON "loan_vehicles"("chassisNumber");

-- CreateIndex
CREATE INDEX "loan_tenor_changes_loanId_idx" ON "loan_tenor_changes"("loanId");

-- CreateIndex
CREATE INDEX "loan_change_requests_loanId_status_idx" ON "loan_change_requests"("loanId", "status");

-- AddForeignKey
ALTER TABLE "loan_vehicles" ADD CONSTRAINT "loan_vehicles_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_tenor_changes" ADD CONSTRAINT "loan_tenor_changes_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_tenor_changes" ADD CONSTRAINT "loan_tenor_changes_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_change_requests" ADD CONSTRAINT "loan_change_requests_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_change_requests" ADD CONSTRAINT "loan_change_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_change_requests" ADD CONSTRAINT "loan_change_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
