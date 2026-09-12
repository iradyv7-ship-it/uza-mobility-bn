-- AlterTable: the record NCBA asked for — findings, corrective action, certificate, next due
ALTER TABLE "vehicle_inspections"
  ADD COLUMN "findings"       JSONB,
  ADD COLUMN "passed"         BOOLEAN,
  ADD COLUMN "certificateRef" TEXT,
  ADD COLUMN "nextDueAt"      TIMESTAMP(3);
