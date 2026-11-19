import { createHash } from 'node:crypto';

/**
 * The appointed Anbu seats live in each village's leadership row
 * (`game:village-state:<village>`) as `hushAppointees`. Rows written
 * before the squad was renamed hold the same list under the field's earlier
 * name. That name is kept only as a SHA-256 hash, so this repository never
 * spells it out; the field is found by hashing each key of the row.
 *
 * `withHushSeatField` returns the row with the current field filled in
 * from the earlier one when the current field is absent, and with the earlier
 * field removed. Every reader of the seats goes through it, so an old row reads
 * the same as a new one, and every writer that spreads the returned row drops
 * the earlier field, which migrates the row on its next write. A row that
 * already has the current field keeps it: a later appointment wins over the
 * earlier list.
 */
export const HUSH_SEAT_FIELD = 'hushAppointees';

/** SHA-256 of the field's earlier name, exactly as it was stored. */
export const LEGACY_HUSH_SEAT_FIELD_HASH = '275e9266718ca0ad4b5d0b8cbffbd7a23d37fcadc6de432ad0dbba23c4149359';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The key in `row`, other than `currentField`, whose SHA-256 is `legacyHash`. */
export function hashedFieldKey(row: Record<string, unknown>, currentField: string, legacyHash: string): string | undefined {
    for (const key of Object.keys(row)) {
        if (key !== currentField && sha256(key) === legacyHash) return key;
    }
    return undefined;
}

/**
 * Move the field whose name hashes to `legacyHash` onto `currentField`. The
 * current field wins when both are present. Returns the row unchanged when it
 * holds no such field. Generic so tests can drive it with invented names.
 */
export function adoptHashedField<T extends Record<string, unknown>>(
    row: T | null | undefined, currentField: string, legacyHash: string,
): T | null | undefined {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const legacyKey = hashedFieldKey(row, currentField, legacyHash);
    if (!legacyKey) return row;
    const { [legacyKey]: legacyValue, ...rest } = row as Record<string, unknown>;
    const current = rest[currentField];
    return { ...rest, [currentField]: current === undefined ? legacyValue : current } as T;
}

export function withHushSeatField<T extends Record<string, unknown>>(row: T): T;
export function withHushSeatField<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined;
export function withHushSeatField<T extends Record<string, unknown>>(row: T | null | undefined): T | null | undefined {
    return adoptHashedField(row, HUSH_SEAT_FIELD, LEGACY_HUSH_SEAT_FIELD_HASH);
}
