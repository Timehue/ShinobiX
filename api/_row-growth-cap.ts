/**
 * Size ceilings for player-written rows that merge the incoming body over the
 * stored one (player saves, clan saves, village state).
 *
 * Those merges keep keys the server does not know about, and each request is
 * bounded only by the body parser (1-5 MB). So a client could add a fresh
 * junk key on every write and grow one row by megabytes a minute: every later
 * read of the row slows down, the frame builders that read every village row
 * pay for it on each tick, and the nightly save snapshot copies it, which is
 * how the Postgres disk has filled before.
 *
 * The ceilings sit far above every real row (production on 2026-11-04: largest
 * player save 609 KB of JSON, largest clan 56 KB, largest village 5 KB). A
 * write is refused only when it would leave the row over its ceiling AND
 * larger than it already is, so a row that is somehow already over the line
 * can still be saved as long as the write does not grow it.
 */
export const ROW_GROWTH_CAPS = {
    playerSave: 4 * 1024 * 1024,
    clanSave: 512 * 1024,
    villageState: 256 * 1024,
} as const;

/** JSON length of a stored value (UTF-16 units; a cheap, stable proxy for bytes). */
export function jsonLength(value: unknown): number {
    if (value === undefined || value === null) return 0;
    try {
        return JSON.stringify(value)?.length ?? 0;
    } catch {
        // A value that cannot be serialized cannot be stored either.
        return Number.POSITIVE_INFINITY;
    }
}

/** True when writing `next` over `prev` would grow the row past `cap`. */
export function exceedsRowGrowthCap(prev: unknown, next: unknown, cap: number): boolean {
    const nextLength = jsonLength(next);
    if (nextLength <= cap) return false;
    return nextLength > jsonLength(prev);
}

export const ROW_TOO_LARGE_ERROR = 'This record is too large to save. Unknown or oversized fields were sent.';
