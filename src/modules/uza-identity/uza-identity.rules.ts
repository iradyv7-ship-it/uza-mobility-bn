import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * The shape of a UZA ID, and what a link between UZA and another system may say.
 *
 * Pure functions, no database — the same shape as `allocation.rules.ts` and
 * `job-card.state.ts`, and for the same reason: the identifier format is the one fact every
 * other UZA system depends on, and it must be testable without a Postgres container.
 *
 * ── Why the format is pinned here ────────────────────────────────────────────────────────
 *
 * `prisma/migrations/20260822100000_uza_identity/migration.sql` backfills existing accounts
 * with `'UZA-P-' || year || '-' || LPAD(seq, 6, '0')`, ordered by (createdAt, id) so that
 * re-running it against a restored snapshot produces byte-identical identifiers. Any code
 * that allocates or parses an identifier has to agree with that SQL exactly, or a restore
 * and the application would disagree about who somebody is. `formatUzaId` is the one place
 * the format is written in TypeScript; `parseUzaId` is its inverse, and the round-trip is
 * asserted in the spec beside this file.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────────────────
 *
 * Nothing in this file decides whether a person SHOULD have an identifier. Allocation is a
 * database operation (a row lock on `id_sequences`) and lives in the service.
 */

export const UZA_ID_PREFIX = 'UZA-P-';

/** `UZA-P-2026-000042`. Four-digit year, six-digit zero-padded sequence within that year. */
export const UZA_ID_PATTERN = /^UZA-P-(\d{4})-(\d{6})$/;

/** The scope name in `id_sequences`, as the migration's allocator row writes it. */
export const PERSON_SEQUENCE_SCOPE = 'person';

/**
 * The systems named on `IdentityLink` in the schema.
 *
 * Advisory, not a whitelist: the whole point of `identity_links` is that a system built
 * next year can write a row without a schema change, so refusing an unknown key would
 * defeat the table. It is exported so the API documentation can name the ones that exist
 * today rather than leaving the caller to guess at spelling.
 */
export const KNOWN_IDENTITY_SYSTEMS: readonly string[] = [
  'uza-charge',
  'garage',
  'nexus',
  'unguka-portal',
];

/**
 * A system key is lowercase kebab.
 *
 * Case is normalised rather than rejected because `("garage", "J-1")` and
 * `("Garage", "J-1")` are the same link, and `@@unique([system, externalId])` would happily
 * store both — two rows claiming the same external record, which is precisely the
 * reconciliation exercise this table exists to abolish.
 */
export const IDENTITY_SYSTEM_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** The longest external key we will store. Long enough for a UUID, a cuid or a plate. */
export const MAX_EXTERNAL_ID_LENGTH = 128;

export function formatUzaId(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new BadRequestException(`${year} is not a four-digit year.`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) {
    throw new BadRequestException(
      `${sequence} is outside the six-digit sequence this format allows.`,
    );
  }
  return `${UZA_ID_PREFIX}${year}-${String(sequence).padStart(6, '0')}`;
}

/** Trim and upper-case. Does not validate — `parseUzaId` is what validates. */
export function normaliseUzaId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isUzaId(raw: string): boolean {
  return UZA_ID_PATTERN.test(normaliseUzaId(raw));
}

/**
 * The year and sequence inside an identifier.
 *
 * Exists so that a caller holding only an identifier can still answer "which year's
 * allocator issued this" without a query — which is what makes the allocator's high-water
 * mark checkable against the identifiers already issued.
 */
export function parseUzaId(raw: string): { year: number; sequence: number } {
  const match = UZA_ID_PATTERN.exec(normaliseUzaId(raw));
  if (!match) {
    throw new BadRequestException(
      `"${raw.trim()}" is not a UZA ID. The format is ${UZA_ID_PREFIX}YYYY-NNNNNN, for example ${UZA_ID_PREFIX}2026-000042.`,
    );
  }
  return {
    year: Number.parseInt(match[1], 10),
    sequence: Number.parseInt(match[2], 10),
  };
}

export function normaliseSystem(raw: string): string {
  const system = raw.trim().toLowerCase();
  if (!IDENTITY_SYSTEM_PATTERN.test(system)) {
    throw new BadRequestException(
      `"${raw.trim()}" is not a system key. Use lowercase letters, digits and hyphens — for example ${KNOWN_IDENTITY_SYSTEMS.join(', ')}.`,
    );
  }
  return system;
}

export function normaliseExternalId(raw: string): string {
  const externalId = raw.trim();
  if (!externalId) {
    throw new BadRequestException(
      "An external id is required — it is the other system's own key for this person.",
    );
  }
  if (externalId.length > MAX_EXTERNAL_ID_LENGTH) {
    throw new BadRequestException(
      `That external id is longer than ${MAX_EXTERNAL_ID_LENGTH} characters.`,
    );
  }
  return externalId;
}

/**
 * A link may be re-confirmed. It may never be silently re-pointed.
 *
 * `@@unique([system, externalId])` means one external record maps to exactly one person.
 * Moving that mapping is a real event — somebody was served under the wrong file — and it
 * must be done deliberately, with both identifiers named, rather than by an upsert quietly
 * overwriting the old one on the next visit to the garage.
 */
export function assertLinkTarget(
  existing: { uzaId: string; system: string; externalId: string } | null,
  uzaId: string,
): void {
  if (!existing || existing.uzaId === uzaId) return;
  throw new ConflictException(
    `${existing.system}/${existing.externalId} is already linked to ${existing.uzaId}, not ${uzaId}. ` +
      'Re-pointing an existing link is a correction and has to be made against that record.',
  );
}
