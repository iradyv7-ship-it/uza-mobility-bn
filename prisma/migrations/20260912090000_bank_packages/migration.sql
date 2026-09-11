-- CreateTable
CREATE TABLE "bank_packages" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "bankFileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "itemsSnapshot" JSONB NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_packages_ref_key" ON "bank_packages"("ref");

-- CreateIndex
CREATE INDEX "bank_packages_bankFileId_idx" ON "bank_packages"("bankFileId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_packages_bankFileId_version_key" ON "bank_packages"("bankFileId", "version");

-- AddForeignKey
ALTER TABLE "bank_packages" ADD CONSTRAINT "bank_packages_bankFileId_fkey" FOREIGN KEY ("bankFileId") REFERENCES "bank_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
