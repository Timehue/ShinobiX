/*
 * World-position self-heal.
 *
 * The server is authoritative for which sector a player stands in — it is
 * lease-gated in api/_realtime/online-store.ts so it CANNOT be teleported to
 * bypass the anti-cheat (attack co-location, the Death's Gate 2x multiplier, the
 * home-terrain buff all read it). The client's `currentSector` can nonetheless
 * drift away from that truth:
 *   - a remote raid / village-war / creator-event sets an arena BACKDROP sector
 *     without the player actually relocating, so the server keeps them where they
 *     were while the client thinks they moved;
 *   - the 3s travel mask leads the lease by a beat around arrival;
 *   - any future code path forgets to keep the two in sync.
 *
 * Presence and visibility (who you see, and who sees you) key off the two AGREEING
 * — sector-mates are filtered by the viewer's own currentSector — so any drift
 * makes co-located players invisible to each other. Rather than chase every path
 * that can cause a drift, this makes the client continuously reconcile to the
 * server's authoritative position each heartbeat: the system always converges, so
 * a desync can never strand a player again. It moves only the CLIENT's view — the
 * server's authority (and therefore the anti-cheat) is untouched.
 *
 * The predicate is deliberately conservative: it NEVER fights a real trip. It
 * stays out while either side is mid-travel (the client leads during the mask; the
 * server flags its own in-flight lease via `serverTraveling`), and it ignores a
 * stale response whose reported sector no longer matches the live one.
 */
export type WorldSectorReconcileInput = {
    /** `sector` from the heartbeat response — the server's authoritative position. */
    serverSector: unknown;
    /** `traveling` from the heartbeat response — the server has a live travel lease. */
    serverTraveling: unknown;
    /** The sector THIS heartbeat reported (presenceBody.sector at send time). */
    sentSector: number;
    /** The viewer's live currentSector right now (currentSectorRef.current). */
    currentSector: number;
    /** Whether the client is mid-travel (isTraveling || a pending travel exists). */
    clientTraveling: boolean;
};

/**
 * The sector to snap `currentSector` to so it matches the server's authoritative
 * world position, or `null` to leave it alone. Returns a non-negative integer
 * only when there is a genuine, settled drift to correct.
 */
export function worldSectorReconcileTarget(input: WorldSectorReconcileInput): number | null {
    const { serverSector, serverTraveling, sentSector, currentSector, clientTraveling } = input;
    // Old server that doesn't report its authoritative sector yet — nothing to do.
    if (typeof serverSector !== "number" || !Number.isFinite(serverSector)) return null;
    // A real trip is in flight on either side — the client legitimately leads the
    // lease during the mask, and the server's own in-flight flag covers the ~1-beat
    // arrival-settle window. Never bounce a traveller.
    if (serverTraveling === true || clientTraveling) return null;
    // Stale response: our sector changed since this beat was sent, so the server's
    // answer describes a position we've already left. Wait for a fresh beat.
    if (sentSector !== currentSector) return null;
    const target = Math.max(0, Math.floor(serverSector));
    // Already in agreement — no snap.
    if (target === currentSector) return null;
    return target;
}
