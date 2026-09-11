-- CreateEnum
CREATE TYPE "LenderDecisionOutcome" AS ENUM ('APPROVED', 'REJECTED', 'CONDITIONAL');

-- CreateTable
CREATE TABLE "lender_decisions" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "outcome" "LenderDecisionOutcome" NOT NULL,
    "reasons" TEXT NOT NULL,
    "conditions" TEXT,
    "decidedByRef" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lender_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "info_requests" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "askedByRef" TEXT,
    "answeredByRef" TEXT,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "info_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lender_decisions_loanId_decidedAt_idx" ON "lender_decisions"("loanId", "decidedAt");

-- CreateIndex
CREATE INDEX "info_requests_loanId_askedAt_idx" ON "info_requests"("loanId", "askedAt");

-- CreateIndex
CREATE INDEX "credit_notes_loanId_createdAt_idx" ON "credit_notes"("loanId", "createdAt");

-- AddForeignKey
ALTER TABLE "lender_decisions" ADD CONSTRAINT "lender_decisions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
