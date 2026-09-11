import type { ItemSource } from '@prisma/client';

export interface RequiredBankFileItem {
  code: string;
  label: string;
  source: ItemSource;
}

/**
 * UZA's own eleven-item checklist — the fallback every bank gets until it has its own
 * rows in `LenderRequirement`.
 *
 * This used to live only inside `prisma/seed-tunga-candidates.ts`. Pulled out here so it
 * has exactly one definition: the seed script imports it to open a file, and
 * `LenderRequirementsService.resolveRequiredItems` imports it as the fallback when a bank
 * has not configured its own list. Two copies of "the eleven things a lender asks for"
 * drifting apart is precisely the failure mode `CLAUDE.md`'s contracts rule exists to
 * prevent, even inside a single repository.
 */
export const DEFAULT_BANK_FILE_ITEMS: readonly RequiredBankFileItem[] = [
  { code: 'APPLICATION_FORM', label: 'Application form', source: 'generated' },
  { code: 'NATIONAL_ID', label: 'National identity card', source: 'uploaded' },
  { code: 'DRIVING_LICENCE', label: 'Driving licence', source: 'uploaded' },
  {
    code: 'CRB_REPORT',
    label: 'Credit reference bureau report',
    source: 'external',
  },
  {
    code: 'TRAINING_CERTIFICATE',
    label: 'UZA Academy certificate',
    source: 'generated',
  },
  {
    code: 'READINESS_SCORE',
    label: 'Readiness score and evidence',
    source: 'generated',
  },
  { code: 'INCOME_EVIDENCE', label: 'Measured daily net', source: 'generated' },
  {
    code: 'CONTRIBUTION_PROOF',
    label: 'Proof of client contribution',
    source: 'uploaded',
  },
  { code: 'PROFORMA', label: 'Vehicle proforma invoice', source: 'generated' },
  {
    code: 'INSURANCE_QUOTE',
    label: 'Comprehensive insurance quotation',
    source: 'generated',
  },
  {
    code: 'VEHICLE_ALLOCATION',
    label: 'Allocated vehicle and VIN',
    source: 'generated',
  },
] as const;
