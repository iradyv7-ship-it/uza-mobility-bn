/**
 * Every financial institution with a portal, described as data.
 *
 * Deliberately duplicated from uza-mobility-fn's `src/config/lenders.ts` rather than
 * shared across a package boundary — the two repositories deploy separately (the same
 * reasoning `uza-mobility-fn/src/types/workshop/job-card.ts` gives for not importing the
 * job-card states). But this copy is the one that matters: the frontend's own comment on
 * that file says it plainly — "reachable only from a route that is not mounted... and
 * refused again by the API, **which is the enforcement that counts**." Every guard in
 * this module reads from here, never from anything the caller supplies.
 *
 * Keep this in sync with `uza-mobility-fn/src/config/lenders.ts` by hand. Both files
 * carry this same note.
 */
export interface LenderConfig {
  readonly key: string;
  readonly name: string;
  readonly seesCollateral?: boolean;
}

export const LENDERS: readonly LenderConfig[] = [
  { key: 'unguka', name: 'Unguka Bank (LOLC)', seesCollateral: true },
  { key: 'equity', name: 'Equity Bank Rwanda' },
  { key: 'ncba', name: 'NCBA Rwanda' },
] as const;

export function findLender(key: string): LenderConfig | undefined {
  const normalised = key.trim().toLowerCase();
  return LENDERS.find((l) => l.key === normalised);
}

/** Derived from the key, never listed separately, so the two cannot drift apart. */
export function lenderRole(key: string): string {
  return `LENDER_${key.trim().toUpperCase()}`;
}
