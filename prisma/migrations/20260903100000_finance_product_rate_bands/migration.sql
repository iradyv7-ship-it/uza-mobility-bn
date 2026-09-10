-- `FinanceProductRateBand` has existed in schema.prisma since the Tunga Taxi programme
-- pack (20260822203128_tunga_taxi_programme_pack) but its migration was never written —
-- pre-existing drift, found while diffing the schema for an unrelated change (see
-- 20260903090000_workshop_and_lender_loans/migration.sql's header note). Deliberately its
-- own migration so it stays reviewable as exactly what it claims to be.

-- CreateTable
CREATE TABLE "finance_product_rate_bands" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "maxTenorMonths" INTEGER NOT NULL,
    "annualRateBps" INTEGER NOT NULL,

    CONSTRAINT "finance_product_rate_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_product_rate_bands_productId_idx" ON "finance_product_rate_bands"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_product_rate_bands_productId_maxTenorMonths_key" ON "finance_product_rate_bands"("productId", "maxTenorMonths");

-- AddForeignKey
ALTER TABLE "finance_product_rate_bands" ADD CONSTRAINT "finance_product_rate_bands_productId_fkey" FOREIGN KEY ("productId") REFERENCES "finance_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
