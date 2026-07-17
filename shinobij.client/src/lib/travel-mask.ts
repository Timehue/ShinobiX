/*
 * travel-mask: how long the "Traveling" loading mask runs, on the LOCAL clock.
 *
 * /api/player/travel answers with `arrivalAt` — an absolute deadline stamped
 * with the SERVER's clock — plus `travelMs`, the duration. Only the server can
 * read its own timestamp meaningfully: it owns the travel lease, the presence
 * row and attackability, and it never trusts the client's copy back
 * (see api/_realtime/online-store.ts upsert, which keeps its own travelingUntil).
 *
 * The client must therefore mask on the duration, never on
 * `arrivalAt - Date.now()`: that subtraction spans two machines' clocks and
 * silently turns any drift between them into the timer the player sits through.
 * A browser three minutes behind the server showed "183s" for a three-second
 * trip — and really did wait that long, because the same delta fed setTimeout.
 * Players' clocks are frequently wrong, so this has to hold for any of them.
 */

/** Fallback when the server predates `travelMs` (matches WORLD_TRAVEL_MS). */
export const TRAVEL_MASK_MS = 3_000;
/** Upper bound: the mask is a loading veil, never a distance tax. No answer —
 *  stale, hostile or garbled — may strand a player behind it longer than this. */
export const TRAVEL_MASK_MAX_MS = 10_000;

/** Local-clock duration for the travel mask, from the server's `travelMs`. */
export function travelMaskMs(travelMs: unknown): number {
    if (travelMs === undefined || travelMs === null) return TRAVEL_MASK_MS;
    const ms = Number(travelMs);
    if (!Number.isFinite(ms)) return TRAVEL_MASK_MS;
    return Math.max(0, Math.min(TRAVEL_MASK_MAX_MS, ms));
}
