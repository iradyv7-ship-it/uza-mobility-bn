import { describe, expect, it } from 'vitest';
import {
  parseEmailRequirements,
  slugifyToCode,
} from './document-requirements.parser';

/**
 * Onboarding a new bank should cost a paste, not a pull request. These tests are the
 * only thing standing between "a bank emailed us their checklist" and a broken import
 * that silently drops half of it.
 */

describe('parsing a numbered email', () => {
  const email = `Dear team,

Please find the documents required for this facility:

1. 10% deposit proof - MoMo or bank slip
2. Bank statement 12 months (stamped)
3. Autorisation de transport (optional)
4. National ID both sides

Kind regards,
Alice, Credit Desk`;

  const parsed = parseEmailRequirements(email);

  it('drops the greeting, intro line and sign-off entirely', () => {
    expect(parsed.every((r) => !/dear|kind regards|alice/i.test(r.label))).toBe(
      true,
    );
  });

  it('recovers exactly the four requirements, in order', () => {
    expect(parsed).toHaveLength(4);
    expect(parsed.map((r) => r.label)).toEqual([
      '10% deposit proof',
      'Bank statement 12 months (stamped)',
      'Autorisation de transport',
      'National ID both sides',
    ]);
  });

  it('splits "Label - guidance" into label and guidance', () => {
    expect(parsed[0]).toMatchObject({
      label: '10% deposit proof',
      guidance: 'MoMo or bank slip',
    });
  });

  it('marks the "(optional)" line as not required, and the rest as mandatory', () => {
    expect(parsed.map((r) => r.required)).toEqual([true, true, false, true]);
  });

  it('gives every requirement a stable, non-empty uppercase-snake code', () => {
    for (const r of parsed) {
      expect(r.code).toMatch(/^[A-Z0-9_]+$/);
      expect(r.code.length).toBeGreaterThan(0);
    }
  });
});

describe('parsing a bulleted email with mandatory wording', () => {
  const email = `Hello,

Kindly find below the requirements:
• CRB clearance (mandatory)
• Association membership card
• Proof of income – payslip or MoMo statement

Regards,
Bank of Kigali Credit Team`;

  const parsed = parseEmailRequirements(email);

  it('treats an explicit "(mandatory)" marker as required', () => {
    const crb = parsed.find((r) => /crb/i.test(r.label));
    expect(crb?.required).toBe(true);
    expect(crb?.label).not.toMatch(/mandatory/i);
  });

  it('handles the en-dash "Label – guidance" form', () => {
    const income = parsed.find((r) => /proof of income/i.test(r.label));
    expect(income?.guidance).toContain('payslip');
  });
});

describe('lines that are not requirements', () => {
  it('produces nothing from a pure signature block', () => {
    const email = `Kind regards,\nJohn Doe\nSenior Credit Officer\n+250 788 000 000`;
    expect(parseEmailRequirements(email)).toEqual([]);
  });

  it('strips the quote marker and drops the "on ... wrote:" reply header', () => {
    const email = `> On Tue, UZA wrote:\n1. National ID\n2. Driving licence`;
    const parsed = parseEmailRequirements(email);
    expect(parsed.map((r) => r.label)).toEqual([
      'National ID',
      'Driving licence',
    ]);
  });

  it('skips a long sentence rather than treating it as a document name', () => {
    const email =
      'Please note that all applicants must have completed the training programme before their file can be considered by our credit committee for approval.';
    expect(parseEmailRequirements(email)).toEqual([]);
  });

  it('caps at 40 requirements even if the paste is enormous', () => {
    const lines = Array.from(
      { length: 60 },
      (_, i) => `${i + 1}. Requirement number ${i + 1}`,
    ).join('\n');
    expect(parseEmailRequirements(lines).length).toBeLessThanOrEqual(40);
  });

  it('never produces two rows with the same code', () => {
    const email = '1. National ID\n2. national id (copy)';
    const parsed = parseEmailRequirements(email);
    const codes = parsed.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('slugifyToCode', () => {
  it('produces a stable uppercase-snake identifier', () => {
    expect(slugifyToCode('10% deposit proof')).toBe('10_DEPOSIT_PROOF');
    expect(slugifyToCode('Autorisation de transport')).toBe(
      'AUTORISATION_DE_TRANSPORT',
    );
  });

  it('strips accents so a francophone label still matches its own code', () => {
    expect(slugifyToCode('Autorisation à conduire')).toBe(
      'AUTORISATION_A_CONDUIRE',
    );
  });
});
