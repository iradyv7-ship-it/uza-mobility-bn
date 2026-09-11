import type { ItemSource } from '@prisma/client';

/**
 * Whether a bank package may be published — checked before a single byte of PDF is
 * rendered.
 *
 * Ported from the reasoning in Project Harmony's bank-package validation (pdf-lib
 * preview screen): a package is a document a bank acts on, so publishing it with a
 * mandatory item unresolved, or with a status that contradicts the evidence on file, is
 * worse than refusing to publish at all. `BankFileGeneratorService` already refuses to
 * fabricate a missing item (see its own doc comment); this is the second half of that
 * promise — refusing to *ship* a file that still has one.
 *
 * Every item in this schema is mandatory (there is no optional/required flag on
 * `BankFileItem` the way Project Harmony's checklist has one) — a file is "ready" only
 * once every required item is present, and that is exactly what gates `BankFile.status`
 * moving to `ready` in `BankFileGeneratorService.generateForFile`. Publishing re-checks
 * the same fact independently rather than trusting the cached `status` column, because a
 * status can go stale between the last generation run and the publish click.
 */

export type PublishIssueCode =
  'missing_mandatory' | 'inconsistent_status' | 'dropped_mandatory';

export interface PublishIssue {
  code: PublishIssueCode;
  itemCode: string | null;
  message: string;
}

export interface PublishableItem {
  code: string;
  label: string;
  source: ItemSource;
  present: boolean;
  documentUrl: string | null;
}

/**
 * @param items The file's current `BankFileItem` rows.
 * @param requiredCodes Every code this file's lender is known to require (from
 *   `LenderRequirementsService`, or the UZA default) — used only to catch a required
 *   item that has no row on the file at all, which `items` alone cannot reveal.
 */
export function validateBankFileForPublish(
  items: readonly PublishableItem[],
  requiredCodes: readonly string[] = [],
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const seen = new Set(items.map((item) => item.code));

  for (const item of items) {
    if (!item.present) {
      issues.push({
        code: 'missing_mandatory',
        itemCode: item.code,
        message: `"${item.label}" is required and still missing — it cannot be published.`,
      });
      continue;
    }

    // A generated item is rendered on demand and legitimately has no stored URL. An
    // uploaded or externally-fetched item marked present without one is a contradiction:
    // either it was never actually attached, or the row was flipped by hand.
    if (item.source !== 'generated' && !item.documentUrl) {
      issues.push({
        code: 'inconsistent_status',
        itemCode: item.code,
        message: `"${item.label}" is marked present but has no document on file.`,
      });
    }
  }

  for (const code of requiredCodes) {
    if (!seen.has(code)) {
      issues.push({
        code: 'dropped_mandatory',
        itemCode: code,
        message: `This lender requires "${code}", and this file has no row for it at all — sync requirements before publishing.`,
      });
    }
  }

  return issues;
}
