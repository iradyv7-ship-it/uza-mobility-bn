import { describe, expect, it } from 'vitest';
import {
  validateBankFileForPublish,
  type PublishableItem,
} from './bank-package-validation';

/**
 * The gate between "every item looks fine in the admin screen" and "this PDF went to a
 * bank". A published package is a document somebody signs; these are the ways this file
 * refuses to let that happen on a false premise.
 */

const item = (patch: Partial<PublishableItem>): PublishableItem => ({
  code: 'NATIONAL_ID',
  label: 'National identity card',
  source: 'uploaded',
  present: true,
  documentUrl: 'https://files.example/national-id.pdf',
  ...patch,
});

describe('publishing a bank package', () => {
  it('passes a file where every item is present and consistent', () => {
    const items = [
      item({ code: 'NATIONAL_ID' }),
      item({
        code: 'APPLICATION_FORM',
        source: 'generated',
        documentUrl: null,
      }),
    ];
    expect(validateBankFileForPublish(items)).toEqual([]);
  });

  it('blocks on any item still missing, naming it specifically', () => {
    const items = [item({ code: 'CRB_REPORT', present: false })];
    const issues = validateBankFileForPublish(items);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'missing_mandatory',
      itemCode: 'CRB_REPORT',
    });
    expect(issues[0].message).toContain('required');
  });

  it('never lets a generated item block on a missing URL — it is rendered on demand', () => {
    const items = [
      item({
        code: 'READINESS_SCORE',
        source: 'generated',
        present: true,
        documentUrl: null,
      }),
    ];
    expect(validateBankFileForPublish(items)).toEqual([]);
  });

  it('flags an uploaded item marked present with nothing actually attached', () => {
    const items = [
      item({
        code: 'CONTRIBUTION_PROOF',
        source: 'uploaded',
        present: true,
        documentUrl: null,
      }),
    ];
    const issues = validateBankFileForPublish(items);
    expect(issues).toEqual([
      {
        code: 'inconsistent_status',
        itemCode: 'CONTRIBUTION_PROOF',
        message: expect.stringContaining('no document on file'),
      },
    ]);
  });

  it('flags a lender requirement that has no row on the file at all', () => {
    const items = [item({ code: 'NATIONAL_ID' })];
    const issues = validateBankFileForPublish(items, [
      'NATIONAL_ID',
      'PROOF_OF_ASSOCIATION',
    ]);
    expect(issues).toEqual([
      {
        code: 'dropped_mandatory',
        itemCode: 'PROOF_OF_ASSOCIATION',
        message: expect.stringContaining('PROOF_OF_ASSOCIATION'),
      },
    ]);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const items = [
      item({ code: 'NATIONAL_ID', present: false }),
      item({ code: 'CRB_REPORT', present: true, documentUrl: null }),
    ];
    const issues = validateBankFileForPublish(items);
    expect(issues.map((i) => i.itemCode).sort()).toEqual([
      'CRB_REPORT',
      'NATIONAL_ID',
    ]);
  });
});
