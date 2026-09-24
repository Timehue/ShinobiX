/*
 * Beastbound Warfront kickoff pace.
 *
 * A fresh Warfront seed is never minted less than a minute after the previous
 * kickoff, so the result endpoint cannot become a seed oracle: settle a hopeless
 * seed at once, roll another. That minute used to be enforced by refusing to
 * SETTLE any match before it elapsed, which held every short match's result on
 * "Sealing the authoritative result…" for up to half a minute after the player
 * had watched the whole fight. Settlement now records whatever is left of the
 * minute here, and warfront-start refuses a new seed until it has passed — the
 * same one-seed-a-minute ceiling, with the wait moved off the result screen.
 */
export const WARFRONT_KICKOFF_PACE_MS = 60_000;

export type WarfrontNextStart = { notBefore: number; battleToken?: string };

export function warfrontNextStartKey(playerName: string): string {
    return `pet:warfront-next-start:${playerName}`;
}

/** Milliseconds until a new Warfront may be minted, or 0 when it may now. */
export function warfrontKickoffWaitMs(value: unknown, now = Date.now()): number {
    if (!value || typeof value !== 'object') return 0;
    const notBefore = Number((value as Partial<WarfrontNextStart>).notBefore);
    if (!Number.isSafeInteger(notBefore) || notBefore <= now) return 0;
    // A pace can only ever be one minute long; anything further out is not a
    // record this module wrote and must not lock a player out.
    return Math.min(notBefore - now, WARFRONT_KICKOFF_PACE_MS);
}
