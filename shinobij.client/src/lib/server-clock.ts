/*
 * server-clock: the server's clock, as seen from this browser.
 *
 * Most deadlines in a save are minted with the SERVER's clock — training and
 * jutsu-training `endsAt` (api/training/_jutsu-ryo, api/pet/progress), pet
 * expeditions, war `pendingUntil` (api/world-state), a peer's `travelingUntil`
 * (api/_realtime/online-store) — and the server re-checks them against that same
 * clock. Comparing them to a local `Date.now()` therefore spans two machines, so
 * a player whose clock is wrong reads every one of those timers wrong: training
 * that "never finishes" if they are behind, or a Claim that does nothing if they
 * are ahead (the server still says no). Players' clocks are frequently wrong —
 * one drifting ~3 minutes turned a 3s travel mask into a 183s wait.
 *
 * So: hold the offset between the two clocks, and let callers ask for
 * `serverNow()` wherever they mean "the clock that minted this timestamp".
 * The offset is seeded from the heartbeat, which already round-trips constantly.
 *
 * This is display/gating only — the server remains authoritative and never
 * trusts a client-supplied deadline. Until the first sample the offset is 0, so
 * behaviour is identical to plain `Date.now()`.
 */

/** Only adopt a sample that moves the offset by more than this. Round-trip time
 *  biases each sample by a few hundred ms, and a countdown that re-renders every
 *  tick must not jitter; a real drift dwarfs the deadband, so it still lands. */
const OFFSET_DEADBAND_MS = 1_000;
/** A slow answer makes a poor clock sample — its stamp is already stale. */
const MAX_SAMPLE_AGE_MS = 5_000;

let offsetMs = 0;

/**
 * Record a server timestamp. `sentAt` (when the request left) is optional: pass
 * it and the sample is round-trip corrected, omit it and the offset is biased
 * low by the round trip — which the deadband already absorbs.
 */
export function noteServerTime(serverNow: unknown, sentAt?: number, receivedAt: number = Date.now()): void {
    const stamp = Number(serverNow);
    if (!Number.isFinite(stamp) || stamp <= 0) return;
    let reference = receivedAt;
    if (sentAt !== undefined && Number.isFinite(sentAt)) {
        const roundTrip = receivedAt - sentAt;
        if (roundTrip < 0 || roundTrip > MAX_SAMPLE_AGE_MS) return;
        reference = sentAt + roundTrip / 2;
    }
    const sample = stamp - reference;
    if (Math.abs(sample - offsetMs) <= OFFSET_DEADBAND_MS) return;
    offsetMs = sample;
}

/** Now, on the clock that minted the server's deadlines. */
export function serverNow(): number {
    return Date.now() + offsetMs;
}

/** How far this browser's clock sits from the server's (server − local). */
export function serverClockOffsetMs(): number {
    return offsetMs;
}

/** Test seam — the offset is module state that would otherwise leak across cases. */
export function resetServerClock(): void {
    offsetMs = 0;
}
