-- CreateEnum
CREATE TYPE "ContributionCreditSource" AS ENUM ('EARN_IN', 'GRANT', 'PARTNER', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "contribution_credits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "source" "ContributionCreditSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "contribution_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contribution_credits_userId_reference_key" ON "contribution_credits"("userId", "reference");
CREATE INDEX "contribution_credits_userId_grantedAt_idx" ON "contribution_credits"("userId", "grantedAt");

-- AddForeignKey
ALTER TABLE "contribution_credits" ADD CONSTRAINT "contribution_credits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
