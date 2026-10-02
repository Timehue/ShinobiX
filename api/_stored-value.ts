import { isDeepStrictEqual } from 'node:util';

/**
 * Does a value read back from the store match the value a writer meant to put
 * there?
 *
 * Writers whose store write throws (a lost reply) read the key back to learn
 * whether the write landed anyway. In production the store is Postgres
 * (`pgKv` in api/_storage.ts). It saves `JSON.stringify(value)` as jsonb, and
 * compareSet drops the process cache first, so the read-back is the JSON form:
 * an `undefined` field is gone, `-0` is `0`, `NaN` is `null` and a `Date` is
 * its ISO string. A plain deep-equal against the in-memory value then judges a
 * write that DID land as lost. Compare both sides in the JSON form instead.
 * The compare-and-set itself already does (`value = $2::jsonb` in pgKv,
 * `_jsonValueEqual` in the memory store), so only read-backs need this.
 *
 * The QA memory store (`_makeMemoryKv`) clones with `structuredClone`, which
 * keeps every one of those, so a test only sees this through a store that
 * reads back `JSON.parse(JSON.stringify(stored))`.
 */
export function storedValueEquals(stored: unknown, intended: unknown): boolean {
    return isDeepStrictEqual(JSON.parse(JSON.stringify(stored ?? null)), JSON.parse(JSON.stringify(intended ?? null)));
}
