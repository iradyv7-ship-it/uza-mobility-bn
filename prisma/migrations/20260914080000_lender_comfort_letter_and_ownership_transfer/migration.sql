-- CreateEnum
CREATE TYPE "ConsentLanguage" AS ENUM ('EN', 'RW');

-- CreateEnum
CREATE TYPE "VehicleOwnershipStatus" AS ENUM ('COMPANY_OWNED', 'TRANSFERRED_TO_CLIENT');

-- AlterTable
ALTER TABLE "lender_consents" ADD COLUMN     "language" "ConsentLanguage" NOT NULL DEFAULT 'EN';

-- AlterTable
ALTER TABLE "banks" ADD COLUMN     "comfortLetterTemplateUrl" TEXT,
ADD COLUMN     "comfortLetterTemplateUploadedAt" TIMESTAMP(3),
ADD COLUMN     "comfortLetterTemplateUploadedBy" TEXT;

-- AlterTable
ALTER TABLE "loan_vehicles" ADD COLUMN     "ownershipStatus" "VehicleOwnershipStatus" NOT NULL DEFAULT 'COMPANY_OWNED',
ADD COLUMN     "ownershipTransferredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "loan_comfort_letters" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedByRef" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_comfort_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_comfort_letters_loanId_key" ON "loan_comfort_letters"("loanId");

-- AddForeignKey
ALTER TABLE "loan_comfort_letters" ADD CONSTRAINT "loan_comfort_letters_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
