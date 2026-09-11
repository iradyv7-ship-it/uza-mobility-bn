-- CreateTable
CREATE TABLE "lender_requirements" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "guidance" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "source" "ItemSource" NOT NULL DEFAULT 'uploaded',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lender_requirements_bankId_sortOrder_idx" ON "lender_requirements"("bankId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "lender_requirements_bankId_code_key" ON "lender_requirements"("bankId", "code");

-- AddForeignKey
ALTER TABLE "lender_requirements" ADD CONSTRAINT "lender_requirements_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
