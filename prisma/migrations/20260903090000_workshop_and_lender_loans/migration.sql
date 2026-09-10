-- Wires src/modules/workshop/*.ts (job-card state machine, mechanic pool, rescue dispatch)
-- and src/modules/financing/loan-terms.ts to real persistence. Both were fully written
-- and unit-tested before this migration, with zero database tables — see
-- docs/mobility-audit.md for how that was found.
--
-- NOTE: `prisma migrate diff` against the live dev/test database also reported a missing
-- "finance_product_rate_bands" table (the FinanceProductRateBand model already exists in
-- schema.prisma but nobody ever wrote its migration — pre-existing drift, unrelated to
-- this change). That is deliberately NOT included here; fixing it is a separate, single-
-- purpose migration so this one stays reviewable as exactly what it claims to be.

-- CreateEnum
CREATE TYPE "WorkCategory" AS ENUM ('BRAKES', 'STEERING', 'SUSPENSION', 'TYRES', 'HIGH_VOLTAGE', 'BODY', 'GENERAL');

-- CreateEnum
CREATE TYPE "JobCardState" AS ENUM ('BOOKED', 'RECEIVED', 'DIAGNOSING', 'ESTIMATED', 'AWAITING_AUTHORISATION', 'AUTHORISED', 'IN_PROGRESS', 'ADDITIONAL_WORK_FOUND', 'AWAITING_PARTS', 'WORK_COMPLETE', 'QUALITY_CHECK', 'ROAD_TEST', 'READY_FOR_HANDOVER', 'HANDED_OVER', 'CLOSED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MechanicEngagement" AS ENUM ('EMPLOYED', 'CERTIFIED');

-- CreateEnum
CREATE TYPE "MechanicLevel" AS ENUM ('APPRENTICE', 'TECHNICIAN', 'SENIOR', 'MASTER');

-- CreateEnum
CREATE TYPE "RescueStatus" AS ENUM ('REQUESTED', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'COMPLETED', 'NO_RESPONDER_AVAILABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'DECLINED', 'DISBURSED', 'ACTIVE', 'IN_ARREARS', 'CLOSED');

-- CreateEnum
CREATE TYPE "CollateralEntryKind" AS ENUM ('PLEDGED', 'RELEASED', 'CALLED_BACK');

-- AlterTable
ALTER TABLE "banks" ADD COLUMN     "lenderKey" TEXT;

-- CreateTable
CREATE TABLE "mechanics" (
    "id" TEXT NOT NULL,
    "uzaId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "engagement" "MechanicEngagement" NOT NULL,
    "level" "MechanicLevel" NOT NULL,
    "certifiedFor" "WorkCategory"[],
    "certifiedUntil" TIMESTAMP(3) NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mechanics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_cards" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "vin" TEXT,
    "vehiclePlate" TEXT,
    "state" "JobCardState" NOT NULL DEFAULT 'BOOKED',
    "categories" "WorkCategory"[],
    "promisedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "authorisedAt" TIMESTAMP(3),
    "performedByMechanicId" TEXT,
    "checkedByMechanicId" TEXT,
    "qualityCheckPassed" BOOLEAN,
    "roadTestCompleted" BOOLEAN,
    "failedQualityCheck" BOOLEAN NOT NULL DEFAULT false,
    "safetyIncidents" INTEGER NOT NULL DEFAULT 0,
    "authorisedTotalMinor" INTEGER,
    "currentTotalMinor" INTEGER,
    "customerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_calls" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "status" "RescueStatus" NOT NULL DEFAULT 'REQUESTED',
    "distanceKm" DOUBLE PRECISION,
    "reason" TEXT,
    "responderId" TEXT,
    "jobValueMinor" INTEGER,
    "commissionMinor" INTEGER,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rescue_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "financingRequestId" TEXT,
    "bankId" TEXT NOT NULL,
    "borrowerUserId" TEXT NOT NULL,
    "principalRwf" INTEGER NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "monthlyRwf" INTEGER NOT NULL,
    "dailyRwf" INTEGER NOT NULL,
    "totalRepayableRwf" INTEGER NOT NULL,
    "outstandingRwf" INTEGER NOT NULL,
    "arrearsRwf" INTEGER NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "disbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collateral_entries" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "kind" "CollateralEntryKind" NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collateral_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mechanics_userId_key" ON "mechanics"("userId");

-- CreateIndex
CREATE INDEX "mechanics_engagement_level_idx" ON "mechanics"("engagement", "level");

-- CreateIndex
CREATE UNIQUE INDEX "job_cards_reference_key" ON "job_cards"("reference");

-- CreateIndex
CREATE INDEX "job_cards_state_idx" ON "job_cards"("state");

-- CreateIndex
CREATE INDEX "job_cards_promisedAt_idx" ON "job_cards"("promisedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rescue_calls_reference_key" ON "rescue_calls"("reference");

-- CreateIndex
CREATE INDEX "rescue_calls_status_idx" ON "rescue_calls"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loans_reference_key" ON "loans"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "loans_financingRequestId_key" ON "loans"("financingRequestId");

-- CreateIndex
CREATE INDEX "loans_bankId_status_idx" ON "loans"("bankId", "status");

-- CreateIndex
CREATE INDEX "collateral_entries_bankId_idx" ON "collateral_entries"("bankId");

-- CreateIndex
CREATE UNIQUE INDEX "banks_lenderKey_key" ON "banks"("lenderKey");

-- AddForeignKey
ALTER TABLE "mechanics" ADD CONSTRAINT "mechanics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_performedByMechanicId_fkey" FOREIGN KEY ("performedByMechanicId") REFERENCES "mechanics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_checkedByMechanicId_fkey" FOREIGN KEY ("checkedByMechanicId") REFERENCES "mechanics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_calls" ADD CONSTRAINT "rescue_calls_responderId_fkey" FOREIGN KEY ("responderId") REFERENCES "mechanics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_calls" ADD CONSTRAINT "rescue_calls_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrowerUserId_fkey" FOREIGN KEY ("borrowerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_financingRequestId_fkey" FOREIGN KEY ("financingRequestId") REFERENCES "financing_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collateral_entries" ADD CONSTRAINT "collateral_entries_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
