/**
 * Shared types + interface for the realtime online-state layer (Phase 2).
 *
 * The whole point of this layer is to hold live player presence in PROCESS
 * MEMORY on the single always-on Railway instance instead of writing
 * `presence:<name>` to the database on every 1s heartbeat. Every handler in the
 * Express process shares one store instance, so reads are instant and there is
 * zero per-second DB write.
 *
 * `MemoryOnlineStateStore` implements this interface now. When the app ever
 * needs more than one backend instance (Phase 9), a `RedisOnlineStateStore`
 * implements the SAME interface and consumers don't change.
 */

export type OnlinePlayer = {
    /** Canonical (trimmed, lowercased) name — the map key. */
    name: string;
    /** Original-cased name as the client sent it, for display. */
    displayName: string;
    sector: number;
    /** Slimmed presence character (display fields only), or null. */
    character: Record<string, unknown> | null;
    /** ms epoch of the last heartbeat / WS ping. */
    lastSeenAt: number;
    /** ms epoch the player first appeared in this server process. */
    connectedAt: number;
    /** A queued incoming attacker, set by attack.ts, read+cleared by the target. */
    pendingAttacker: unknown | null;
    /** ms epoch while traveling between sectors (untouchable window). */
    travelingUntil?: number;
    /** Server-issued destination for the active three-second travel lease. */
    travelDestinationSector?: number;
    /** Destination tile to adopt when a road-crossing lease matures. */
    travelDestinationTile?: number;
    /** Sector whose room saw this player before a stale, matured travel sweep. */
    departureSector?: number;
    /**
     * true while the SERVER can prove a fight (F01): set from the combat
     * stores by the heartbeat (battle-authority.ts) and by fight hosts at
     * start/terminal. Blocks double-battle, travel, external heals; confers
     * attack immunity. Never taken from a client beat.
     */
    inBattle?: boolean;
    /** Within-sector tile (0..143) for peer rendering and road-exit proximity.
     * Walking remains client supplied; this is not authoritative path validation. */
    tile?: number;
    /** Monotonic server sequence for within-sector movement deltas. */
    movementSeq?: number;
    /** Boot snapshots may render a roster, but cannot authorize gameplay until
     * the first ingress rehydrates position from the durable save/lease. */
    locationUnverified?: boolean;
};

/** Fields a heartbeat / ping supplies to refresh presence. */
export type PresenceUpsert = {
    name: string; // raw; canonicalized internally
    sector: number;
    character: Record<string, unknown> | null;
    travelingUntil?: number;
    /** Client hint only — ignored by upsert (F01). Kept for wire compatibility. */
    inBattle?: boolean;
    tile?: number;
    /** Sector the supplied tile belongs to; differs during stale travel beats. */
    tileSector?: number;
};

export interface OnlineStateStore {
    /**
     * Insert or refresh a player's presence (bumps lastSeenAt). Preserves an
     * existing `pendingAttacker` across beats — only attack.ts/clear-attack.ts
     * mutate it. Returns the resulting record.
     */
    upsert(entry: PresenceUpsert): OnlinePlayer;
    /** A player's live presence, or null if absent/stale (past the offline window). */
    get(name: string): OnlinePlayer | null;
    /** All currently-online (non-stale) players. */
    list(): OnlinePlayer[];
    /** Currently-online players in one sector (sector-indexed, no global scan). */
    listSector(sector: number): OnlinePlayer[];
    /** Forget a player entirely (logout, ban/kick, disconnect). */
    remove(name: string): void;
    /** Queue an incoming attacker on a target. Returns false if the target is offline. */
    setPendingAttacker(name: string, attacker: unknown): boolean;
    /** Clear a player's queued attacker. */
    clearPendingAttacker(name: string): void;
    /** Set/clear the server-owned inBattle flag (fight start/terminal, heartbeat corroboration). */
    setInBattle(name: string, inBattle: boolean): void;
    /** Start a server-owned travel lease. Returns null if the player cannot travel. */
    startTravel(name: string, destinationSector: number, arrivalAt: number, originSector?: number, arrivalTile?: number): OnlinePlayer | null;
    /** Restore a server-persisted lease after a process restart. */
    restoreTravel(name: string, destinationSector: number, arrivalAt: number, originSector: number, arrivalTile?: number): OnlinePlayer | null;
    /** Roll back a lease that could not be persisted. */
    cancelTravel(name: string, arrivalAt: number): void;
    /** Consume the one-shot signal that its persisted lease may be deleted. */
    consumeSettledTravel(name: string): boolean;
    /** Arrival publication awaiting a settle attempt on the next ingress. */
    hasSettledTravel(name: string): boolean;
    /** Retry a failed durable settlement without replaying live movement. */
    retryTravelSettlement(name: string): void;
    /** Apply a within-sector movement intent and return the refreshed record. */
    moveToTile(name: string, tile: number): OnlinePlayer | null;
    /** Drop entries past the offline window. Returns the removed records. */
    sweepStale(): OnlinePlayer[];
    /** Number of tracked entries (including not-yet-swept stale ones). */
    size(): number;
}
