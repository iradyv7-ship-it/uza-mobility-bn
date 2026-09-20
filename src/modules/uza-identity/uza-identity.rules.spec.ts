import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_IDENTITY_SYSTEMS,
  MAX_EXTERNAL_ID_LENGTH,
  UZA_ID_PREFIX,
  assertLinkTarget,
  formatUzaId,
  isUzaId,
  normaliseExternalId,
  normaliseSystem,
  normaliseUzaId,
  parseUzaId,
} from './uza-identity.rules';

describe('the identifier format', () => {
  it('is exactly what the August migration backfills', () => {
    // migration.sql: 'UZA-P-' || yr || '-' || LPAD(seq::TEXT, 6, '0')
    expect(formatUzaId(2026, 42)).toBe('UZA-P-2026-000042');
    expect(formatUzaId(2026, 1)).toBe('UZA-P-2026-000001');
    expect(formatUzaId(2025, 999_999)).toBe('UZA-P-2025-999999');
  });

  it('round-trips through parse', () => {
    for (const [year, sequence] of [
      [2025, 1],
      [2026, 42],
      [2026, 999_999],
    ] as const) {
      expect(parseUzaId(formatUzaId(year, sequence))).toEqual({
        year,
        sequence,
      });
    }
  });

  it('refuses a sequence that would not fit the six digits', () => {
    expect(() => formatUzaId(2026, 0)).toThrow(BadRequestException);
    expect(() => formatUzaId(2026, 1_000_000)).toThrow(BadRequestException);
    expect(() => formatUzaId(2026, 1.5)).toThrow(BadRequestException);
  });

  it('refuses a year that is not four digits', () => {
    expect(() => formatUzaId(26, 1)).toThrow(BadRequestException);
    expect(() => formatUzaId(1999, 1)).toThrow(BadRequestException);
  });
});

describe('reading an identifier somebody typed', () => {
  it('trims and upper-cases before matching', () => {
    expect(normaliseUzaId('  uza-p-2026-000042 ')).toBe('UZA-P-2026-000042');
    expect(isUzaId(' uza-p-2026-000042 ')).toBe(true);
  });

  it('rejects anything that is not the format, and says what the format is', () => {
    for (const bad of [
      'UZA-2026-000042',
      'UZA-P-2026-42',
      'UZA-P-26-000042',
      'UZA-P-2026-0000420',
      '',
      'UZM-ALC-2026-000001',
    ]) {
      expect(() => parseUzaId(bad)).toThrow(BadRequestException);
      expect(isUzaId(bad)).toBe(false);
    }
    expect(() => parseUzaId('nope')).toThrow(new RegExp(UZA_ID_PREFIX));
  });
});

describe('system keys', () => {
  it('accepts the systems the schema already names', () => {
    for (const system of KNOWN_IDENTITY_SYSTEMS) {
      expect(normaliseSystem(system)).toBe(system);
    }
  });

  it('normalises case, because two spellings would be two rows for one record', () => {
    // @@unique([system, externalId]) cannot see that "Garage" and "garage" are the same
    // place, so the normalisation has to happen before the write.
    expect(normaliseSystem('  Garage ')).toBe('garage');
    expect(normaliseSystem('UZA-Charge')).toBe('uza-charge');
  });

  it('refuses a key that is not lowercase kebab', () => {
    for (const bad of [
      '',
      'g',
      '-garage',
      'garage station',
      'garage_1',
      'a'.repeat(33),
    ]) {
      expect(() => normaliseSystem(bad)).toThrow(BadRequestException);
    }
  });

  it('does not restrict the list — a system built next year writes its own key', () => {
    expect(normaliseSystem('uza-bulk')).toBe('uza-bulk');
    expect(KNOWN_IDENTITY_SYSTEMS).not.toContain('uza-bulk');
  });
});

describe('external ids', () => {
  it('trims but otherwise keeps the other system’s key exactly', () => {
    expect(normaliseExternalId('  cmg4k2j0000abc  ')).toBe('cmg4k2j0000abc');
    expect(normaliseExternalId('RAC 123 D')).toBe('RAC 123 D');
  });

  it('refuses an empty key and an absurdly long one', () => {
    expect(() => normaliseExternalId('   ')).toThrow(BadRequestException);
    expect(() =>
      normaliseExternalId('x'.repeat(MAX_EXTERNAL_ID_LENGTH + 1)),
    ).toThrow(BadRequestException);
    expect(
      normaliseExternalId('x'.repeat(MAX_EXTERNAL_ID_LENGTH)),
    ).toHaveLength(MAX_EXTERNAL_ID_LENGTH);
  });
});

describe('what a link may be re-pointed at', () => {
  const link = {
    uzaId: 'UZA-P-2026-000042',
    system: 'garage',
    externalId: 'JOB-1',
  };

  it('allows a first link', () => {
    expect(() => assertLinkTarget(null, 'UZA-P-2026-000042')).not.toThrow();
  });

  it('allows the same link to be confirmed again', () => {
    // A garage terminal calling this on every visit must be a no-op, not an error.
    expect(() => assertLinkTarget(link, 'UZA-P-2026-000042')).not.toThrow();
  });

  it('refuses to silently move a key to a different person, and names both', () => {
    expect(() => assertLinkTarget(link, 'UZA-P-2026-000099')).toThrow(
      ConflictException,
    );
    expect(() => assertLinkTarget(link, 'UZA-P-2026-000099')).toThrow(
      /already linked to UZA-P-2026-000042, not UZA-P-2026-000099/,
    );
  });
});
