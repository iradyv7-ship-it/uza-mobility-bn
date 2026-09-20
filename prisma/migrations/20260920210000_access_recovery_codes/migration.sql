-- CreateTable
CREATE TABLE "access_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_recovery_codes_codeHash_key" ON "access_recovery_codes"("codeHash");
CREATE INDEX "access_recovery_codes_userId_createdAt_idx" ON "access_recovery_codes"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "access_recovery_codes" ADD CONSTRAINT "access_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
