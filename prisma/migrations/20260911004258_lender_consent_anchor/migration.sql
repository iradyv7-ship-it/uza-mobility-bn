-- AlterTable
ALTER TABLE "lender_consents" ADD COLUMN     "fundApplicationId" TEXT,
ALTER COLUMN "uzaId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "lender_consents_fundApplicationId_idx" ON "lender_consents"("fundApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "lender_consents_fundApplicationId_lenderKey_key" ON "lender_consents"("fundApplicationId", "lenderKey");

-- AddForeignKey
ALTER TABLE "lender_consents" ADD CONSTRAINT "lender_consents_fundApplicationId_fkey" FOREIGN KEY ("fundApplicationId") REFERENCES "fund_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

