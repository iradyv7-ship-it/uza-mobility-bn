-- Supplier offers: "here is what we have", the step before an Addendum.
--
-- SupplyOrder/SupplyOrderVehicle already model a COMMITMENT — binding price, accepted
-- evidence pack, a VIN that must exist and be unique. A supplier listing available stock
-- has none of those yet. Rather than loosen the order model (which would let an
-- uncommitted unit look like a committed one), an offer is its own cheap, declinable
-- record, and `convertedSupplyOrderId` is the only bridge to the order side.
--
-- Touches nothing else: the only change to an existing table is none at all — the
-- Supplier relation is the child's foreign key.

-- CreateEnum
CREATE TYPE "SupplierOfferKind" AS ENUM ('VEHICLE', 'SPARE_PART');
CREATE TYPE "SupplierOfferCondition" AS ENUM ('NEW', 'USED');
CREATE TYPE "SupplierOfferStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'CONVERTED_TO_ORDER', 'DECLINED');
CREATE TYPE "SupplierOfferDocumentKind" AS ENUM ('PHOTO', 'INSPECTION_REPORT', 'SPECIFICATION', 'PROFORMA_INVOICE', 'OTHER');

-- CreateTable
CREATE TABLE "supplier_offers" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierOfferKind" NOT NULL DEFAULT 'VEHICLE',
    "vin" TEXT,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "colour" TEXT,
    "condition" "SupplierOfferCondition" NOT NULL DEFAULT 'USED',
    "mileageKm" INTEGER,
    "batterySohPct" INTEGER,
    "accidentHistory" TEXT,
    "partNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "indicativePriceMinor" BIGINT,
    "currency" TEXT NOT NULL,
    "availableFrom" DATE,
    "notes" TEXT,
    "status" "SupplierOfferStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "declinedReason" TEXT,
    "convertedSupplyOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_offer_documents" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "kind" "SupplierOfferDocumentKind" NOT NULL,
    "fileRef" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedByUzaId" TEXT,
    "uploadedByName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "supersedesId" TEXT,

    CONSTRAINT "supplier_offer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_offers_ref_key" ON "supplier_offers"("ref");
CREATE INDEX "supplier_offers_supplierId_status_idx" ON "supplier_offers"("supplierId", "status");
CREATE INDEX "supplier_offers_status_createdAt_idx" ON "supplier_offers"("status", "createdAt");

CREATE UNIQUE INDEX "supplier_offer_documents_fileRef_key" ON "supplier_offer_documents"("fileRef");
CREATE UNIQUE INDEX "supplier_offer_documents_supersedesId_key" ON "supplier_offer_documents"("supersedesId");
CREATE INDEX "supplier_offer_documents_offerId_kind_uploadedAt_idx" ON "supplier_offer_documents"("offerId", "kind", "uploadedAt");

-- AddForeignKey
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_offer_documents" ADD CONSTRAINT "supplier_offer_documents_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supplier_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_offer_documents" ADD CONSTRAINT "supplier_offer_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "supplier_offer_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Engrave: no UPDATE and no DELETE on the evidence table, for anyone, ever. What a
-- supplier showed UZA before a price was agreed is the record that settles a later
-- argument about condition. Same trigger shape as fund_application_documents.
CREATE OR REPLACE FUNCTION supplier_offer_documents_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'supplier_offer_documents is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_offer_documents_no_update
  BEFORE UPDATE OR DELETE ON "supplier_offer_documents"
  FOR EACH ROW EXECUTE FUNCTION supplier_offer_documents_immutable();
