-- CreateEnum
CREATE TYPE "DriverInterestVehicleType" AS ENUM ('MOTO', 'CAB', 'DELIVERY');

-- CreateEnum
CREATE TYPE "DriverInterestStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'CLOSED');

-- CreateTable
CREATE TABLE "driver_interest_leads" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "preferredVehicleType" "DriverInterestVehicleType",
    "message" TEXT,
    "status" "DriverInterestStatus" NOT NULL DEFAULT 'NEW',
    "contactedAt" TIMESTAMP(3),
    "contactedById" TEXT,
    "fundApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_interest_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_interest_leads_status_createdAt_idx" ON "driver_interest_leads"("status", "createdAt");
