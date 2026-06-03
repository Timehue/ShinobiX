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
    /** true while a PvP session is active (blocks double-battle). */
    inBattle?: boolean;
};

/** Fields a heartbeat / ping supplies to refresh presence. */
export type PresenceUpsert = {
    name: string; // raw; canonicalized internally
    sector: number;
    character: Record<string, unknown> | null;
    travelingUntil?: number;
    inBattle?: boolean;
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
    /** Forget a player entirely (logout, ban/kick, disconnect). */
    remove(name: string): void;
    /** Queue an incoming attacker on a target. Returns false if the target is offline. */
    setPendingAttacker(name: string, attacker: unknown): boolean;
    /** Clear a player's queued attacker. */
    clearPendingAttacker(name: string): void;
    /** Set/clear the inBattle flag (PvP session start/end). */
    setInBattle(name: string, inBattle: boolean): void;
    /** Drop entries past the offline window. Returns the removed canonical names. */
    sweepStale(): string[];
    /** Number of tracked entries (including not-yet-swept stale ones). */
    size(): number;
}
