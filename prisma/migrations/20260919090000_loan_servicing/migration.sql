-- CreateEnum
CREATE TYPE "LoanRepaymentSource" AS ENUM ('LENDER_FILE', 'MANUAL', 'SWEEP');

-- AlterTable
ALTER TABLE "loans" ADD COLUMN "paidRwf" INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN "closedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "source" "LoanRepaymentSource" NOT NULL,
    "recordedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayments_loanId_reference_key" ON "loan_repayments"("loanId", "reference");
CREATE INDEX "loan_repayments_loanId_paidAt_idx" ON "loan_repayments"("loanId", "paidAt");

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
