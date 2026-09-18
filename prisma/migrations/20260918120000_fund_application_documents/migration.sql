-- CreateEnum
CREATE TYPE "FundApplicationDocumentKind" AS ENUM ('SIGNED_FORM', 'NATIONAL_ID', 'DRIVING_LICENCE', 'PROOF_OF_SAVINGS', 'OTHER');

-- CreateTable
CREATE TABLE "fund_application_documents" (
    "id" TEXT NOT NULL,
    "fundApplicationId" TEXT NOT NULL,
    "kind" "FundApplicationDocumentKind" NOT NULL,
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

    CONSTRAINT "fund_application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fund_application_documents_fileRef_key" ON "fund_application_documents"("fileRef");
CREATE UNIQUE INDEX "fund_application_documents_supersedesId_key" ON "fund_application_documents"("supersedesId");
CREATE INDEX "fund_application_documents_fundApplicationId_kind_uploadedAt_idx" ON "fund_application_documents"("fundApplicationId", "kind", "uploadedAt");
CREATE INDEX "fund_application_documents_uploadedByUserId_uploadedAt_idx" ON "fund_application_documents"("uploadedByUserId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "fund_application_documents" ADD CONSTRAINT "fund_application_documents_fundApplicationId_fkey" FOREIGN KEY ("fundApplicationId") REFERENCES "fund_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fund_application_documents" ADD CONSTRAINT "fund_application_documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fund_application_documents" ADD CONSTRAINT "fund_application_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "fund_application_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Engrave: no UPDATE and no DELETE on this table, for anyone, ever. A wrong file is
-- superseded by a new row; the old row stays. Enforced in the database, not only in code.
CREATE OR REPLACE FUNCTION fund_application_documents_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fund_application_documents is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fund_application_documents_no_update
  BEFORE UPDATE OR DELETE ON "fund_application_documents"
  FOR EACH ROW EXECUTE FUNCTION fund_application_documents_immutable();
