-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('IN_APP', 'SIGNED_FORM', 'STAFF_RECORDED');

-- CreateTable
CREATE TABLE "lender_consents" (
    "id" TEXT NOT NULL,
    "uzaId" TEXT NOT NULL,
    "lenderKey" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "source" "ConsentSource" NOT NULL DEFAULT 'IN_APP',
    "capturedByRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lender_consents_lenderKey_idx" ON "lender_consents"("lenderKey");

-- CreateIndex
CREATE UNIQUE INDEX "lender_consents_uzaId_lenderKey_key" ON "lender_consents"("uzaId", "lenderKey");
