-- CreateEnum
CREATE TYPE "TrainingCourseSource" AS ENUM ('CHINESE_OEM', 'LOCAL_RWANDAN');

-- CreateEnum
CREATE TYPE "VehicleUnitCondition" AS ENUM ('NEW', 'USED');

-- AlterTable
ALTER TABLE "loan_vehicles" ADD COLUMN     "condition" "VehicleUnitCondition" NOT NULL DEFAULT 'USED';

-- CreateTable
CREATE TABLE "training_courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source" "TrainingCourseSource" NOT NULL,
    "language" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "addedByRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_courses_category_isActive_idx" ON "training_courses"("category", "isActive");
