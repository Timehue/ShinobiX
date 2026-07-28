/**
 * In-memory online-player store (Phase 2).
 *
 * Holds live presence in process memory on the single always-on Railway
 * instance. Replaces the per-second `presence:<name>` DB write/read once the
 * heartbeat + presence consumers are wired to it.
 *
 * Single-instance only: correct because Railway runs ONE process and every
 * handler imports the same `onlineStore` singleton below. Going multi-instance
 * later (Phase 9) means swapping in a Redis-backed implementation of the same
 * `OnlineStateStore` interface — no consumer changes.
 *
 * ⚠️ DEPLOYMENT INVARIANT: the host serving player API traffic
 * (heartbeat / roster / attack / challenge / heal / pvp-move) MUST run a single
 * process. Railway does (one container). cPanel/Passenger spawns MANY workers
 * (see .env.example "Pool size PER process. … cPanel's many worker processes")
 * and is therefore for image + KV-proxy storage ONLY — it must NOT serve those
 * routes, or presence splits across workers (heartbeat lands on worker A,
 * roster/attack read worker B → players show offline, "Target not online",
 * sector-mates vanish). If cPanel ever needs to serve the game API, either pin
 * Passenger to one worker (passenger_max_pool_size=1) on that box or swap in the
 * Redis-backed store first.
 */
import type { OnlinePlayer, OnlineStateStore, PresenceUpsert } from './types.js';
import { safeName } from '../_utils.js';

/** One persisted presence row — identity and position only, no character blob. */
export type PresenceSnapshotRow = {
    name: string;
    displayName: string;
    sector: number;
    lastSeenAt: number;
    connectedAt: number;
};

// A player is considered offline if not seen within this window. Clients keepalive
// every ~20s (socket ping + HTTP reconcile), so a 60s window evicts an active peer
// after a SINGLE missed beat — the root of the sector "pop in/out" flicker. 90s
// tolerates ~4 missed beats (background-tab throttling, a transient socket drop,
// latency) before a live player is dropped from everyone's sector, while still
// clearing a genuinely-closed tab within a beat or two of a minute.
export const OFFLINE_AFTER_MS = 90_000;

// Canonical presence key = the safeName slug, matching the identity returned by
// authedPlayer and every `save:`/`user:` key, so a display name with spaces
// resolves to the same presence entry the heartbeat and kick paths use.
function canon(name: string): string {
    return safeName(name);
}

export class MemoryOnlineStateStore implements OnlineStateStore {
    private players = new Map<string, OnlinePlayer>();
    private sectors = new Map<number, Set<string>>();
    private settledTravelKeys = new Set<string>();
    private readonly offlineAfterMs: number;
    // Injectable clock so tests can advance time deterministically without sleeps.
    private readonly now: () => number;

    constructor(opts?: { offlineAfterMs?: number; now?: () => number }) {
        this.offlineAfterMs = opts?.offlineAfterMs ?? OFFLINE_AFTER_MS;
        this.now = opts?.now ?? Date.now;
    }

    private isFresh(p: OnlinePlayer | undefined, now: number): p is OnlinePlayer {
        return !!p && now - p.lastSeenAt <= this.offlineAfterMs;
    }

    private addToSector(key: string, sector: number): void {
        const names = this.sectors.get(sector) ?? new Set<string>();
        names.add(key);
        this.sectors.set(sector, names);
    }

    private removeFromSector(key: string, sector: number): void {
        const names = this.sectors.get(sector);
        if (!names) return;
        names.delete(key);
        if (!names.size) this.sectors.delete(sector);
    }

    private settleMaturedTravel(key: string, player: OnlinePlayer, now: number): void {
        if (player.travelDestinationSector === undefined || player.travelingUntil === undefined || now < player.travelingUntil) return;
        const previousSector = player.sector;
        player.sector = player.travelDestinationSector;
        if (player.travelDestinationTile !== undefined) player.tile = player.travelDestinationTile;
        player.travelingUntil = undefined;
        player.travelDestinationSector = undefined;
        player.travelDestinationTile = undefined;
        this.settledTravelKeys.add(key);
        if (previousSector !== player.sector) {
            this.removeFromSector(key, previousSector);
            this.addToSector(key, player.sector);
        }
    }

    private applyTravel(
        key: string,
        player: OnlinePlayer,
        destinationSector: number,
        arrivalAt: number,
        originSector?: number,
        arrivalTile?: number,
    ): OnlinePlayer {
        if (originSector !== undefined && originSector !== player.sector) {
            this.removeFromSector(key, player.sector);
            player.sector = originSector;
            this.addToSector(key, player.sector);
        }
        player.travelDestinationSector = destinationSector;
        player.travelDestinationTile = arrivalTile;
        player.travelingUntil = arrivalAt;
        player.lastSeenAt = this.now();
        this.settledTravelKeys.delete(key);
        this.settleMaturedTravel(key, player, this.now());
        return player;
    }

    upsert(entry: PresenceUpsert): OnlinePlayer {
        const key = canon(entry.name);
        const now = this.now();
        const prev = this.players.get(key);
        const preSettleSector = prev?.sector;
        if (prev) this.settleMaturedTravel(key, prev, now);
        // True when THIS beat is the one whose matured lease just advanced the
        // player to their destination (settleMaturedTravel moved prev.sector). On
        // that arrival beat the client can still be reporting its stale origin, so
        // its sector must not be trusted — see the lease-authoritative guard below.
        const justSettledTravel = prev !== undefined && preSettleSector !== prev.sector;
        let sector = entry.sector;
        let travelingUntil = prev?.travelingUntil;
        let travelDestinationSector = prev?.travelDestinationSector;
        let travelDestinationTile = prev?.travelDestinationTile;
        if (prev) {
            // Presence is no longer allowed to teleport a live session. A sector
            // change must either be a safe-zone exit (sector 0) or the matured
            // destination of a lease minted by /player/travel.
            sector = prev.sector;
            // While a travel lease is authoritative — still in flight, OR matured
            // on this very beat — the client's reported sector is NOT trusted for a
            // sector change. For the whole 3s travel mask the client keeps
            // reporting its ORIGIN (currentSector only flips to the destination
            // when the mask ends), and for a village departure that origin is
            // sector 0. Honored, that 0 would look like a safe-zone exit and wipe
            // the outbound lease (mid-flight) or bounce the just-arrived player
            // straight back out of their destination (on the arrival beat) — either
            // way stranding them at 0, invisible to their real sector and everyone
            // in it (the outage this guards). So keep prev.sector: the origin while
            // travelling, the settled destination once matured. Destination-0
            // leases never exist (/player/travel rejects them), so this can only
            // ever suppress a stale origin, never a legitimate move.
            const travelingOut = travelDestinationSector !== undefined
                && travelingUntil !== undefined
                && now < travelingUntil;
            if (justSettledTravel || travelingOut) {
                // Lease authoritative — keep sector = prev.sector and leave the
                // lease fields as-is (intact while travelling; already cleared by
                // settleMaturedTravel on the arrival beat).
            } else if (entry.sector === 0) {
                if (travelingUntil !== undefined || travelDestinationSector !== undefined) this.settledTravelKeys.add(key);
                sector = 0;
                travelingUntil = undefined;
                travelDestinationSector = undefined;
                travelDestinationTile = undefined;
            } else if (entry.sector === prev.sector) {
                // ordinary presence refresh
            } else if (
                travelDestinationSector === entry.sector
                && travelingUntil !== undefined
                && now >= travelingUntil
            ) {
                sector = entry.sector;
                if (travelDestinationTile !== undefined) entry.tile = travelDestinationTile;
                travelingUntil = undefined;
                travelDestinationSector = undefined;
                travelDestinationTile = undefined;
                this.settledTravelKeys.add(key);
            }
        }
        const next: OnlinePlayer = {
            name: key,
            displayName: entry.name,
            sector,
            // Fall back to the previously-stored slim character if this beat sent none.
            character: entry.character ?? prev?.character ?? null,
            lastSeenAt: now,
            connectedAt: prev?.connectedAt ?? now,
            // pendingAttacker survives a refresh — only attack/clear-attack touch it.
            pendingAttacker: prev?.pendingAttacker ?? null,
            travelingUntil,
            travelDestinationSector,
            travelDestinationTile,
            inBattle: entry.inBattle === true ? true : undefined,
            // Within-sector tile for live peer rendering; keep the last known tile
            // if this beat didn't carry one (older client / non-sector screen).
            tile: entry.tile ?? prev?.tile,
            movementSeq: prev?.movementSeq ?? 0,
        };
        if (prev && prev.sector !== next.sector) this.removeFromSector(key, prev.sector);
        this.players.set(key, next);
        this.addToSector(key, next.sector);
        return next;
    }

    get(name: string): OnlinePlayer | null {
        const key = canon(name);
        const p = this.players.get(key);
        const now = this.now();
        if (!this.isFresh(p, now)) return null;
        this.settleMaturedTravel(key, p, now);
        return p;
    }

    list(): OnlinePlayer[] {
        const now = this.now();
        const out: OnlinePlayer[] = [];
        for (const [key, p] of this.players) {
            if (!this.isFresh(p, now)) continue;
            this.settleMaturedTravel(key, p, now);
            out.push(p);
        }
        return out;
    }

    /**
     * Minimal presence rows for persisting across a process restart.
     *
     * Identity + sector + timestamps ONLY — deliberately NOT the `character` blob.
     * Restoring exact display data is not worth the write amplification (200 players ×
     * a slim character every snapshot); the point is that the world is not EMPTY for
     * the first beat after a deploy. Each player's next heartbeat (~20s) refills the
     * display fields anyway.
     */
    snapshot(): PresenceSnapshotRow[] {
        const now = this.now();
        const rows: PresenceSnapshotRow[] = [];
        for (const [, p] of this.players) {
            if (!this.isFresh(p, now)) continue;
            rows.push({ name: p.name, displayName: p.displayName, sector: p.sector, lastSeenAt: p.lastSeenAt, connectedAt: p.connectedAt });
        }
        return rows;
    }

    /**
     * Rehydrate rows saved by `snapshot()`. Rows already past the offline window are
     * dropped, so a snapshot older than OFFLINE_AFTER_MS restores nothing rather than
     * resurrecting ghosts. Never overwrites a live entry — a player whose heartbeat
     * already landed on the new process is fresher than any snapshot.
     */
    restore(rows: readonly PresenceSnapshotRow[]): number {
        const now = this.now();
        let restored = 0;
        for (const row of rows) {
            const key = canon(String(row?.name ?? ''));
            if (!key || this.players.has(key)) continue;
            const lastSeenAt = Number(row.lastSeenAt) || 0;
            if (now - lastSeenAt > this.offlineAfterMs) continue;
            const sector = Number.isFinite(Number(row.sector)) ? Math.max(0, Math.floor(Number(row.sector))) : 0;
            this.players.set(key, {
                name: key,
                displayName: String(row.displayName || row.name || key),
                sector,
                character: null,
                lastSeenAt,
                connectedAt: Number(row.connectedAt) || lastSeenAt,
                pendingAttacker: null,
                travelUntil: null,
                travelFrom: null,
                travelTo: null,
                travelTile: null,
                inBattle: false,
            } as OnlinePlayer);
            this.addToSector(key, sector);
            restored++;
        }
        return restored;
    }

    listSector(sector: number): OnlinePlayer[] {
        const now = this.now();
        const names = this.sectors.get(sector);
        if (!names) return [];
        const out: OnlinePlayer[] = [];
        for (const key of names) {
            const player = this.players.get(key);
            if (this.isFresh(player, now)) out.push(player);
        }
        return out;
    }

    remove(name: string): void {
        const key = canon(name);
        const player = this.players.get(key);
        if (player) this.removeFromSector(key, player.sector);
        this.players.delete(key);
        this.settledTravelKeys.delete(key);
    }

    setPendingAttacker(name: string, attacker: unknown): boolean {
        const p = this.get(name);
        if (!p) return false;
        p.pendingAttacker = attacker;
        return true;
    }

    clearPendingAttacker(name: string): void {
        const p = this.players.get(canon(name));
        if (p) p.pendingAttacker = null;
    }

    setInBattle(name: string, inBattle: boolean): void {
        const p = this.players.get(canon(name));
        if (p) p.inBattle = inBattle ? true : undefined;
    }

    startTravel(name: string, destinationSector: number, arrivalAt: number, originSector?: number, arrivalTile?: number): OnlinePlayer | null {
        const key = canon(name);
        const p = this.get(name);
        if (!p || p.inBattle || (p.travelingUntil !== undefined && p.travelingUntil > this.now())) return null;
        return this.applyTravel(key, p, destinationSector, arrivalAt, originSector, arrivalTile);
    }

    restoreTravel(name: string, destinationSector: number, arrivalAt: number, originSector: number, arrivalTile?: number): OnlinePlayer | null {
        const key = canon(name);
        const p = this.players.get(key);
        if (!p) return null;
        return this.applyTravel(key, p, destinationSector, arrivalAt, originSector, arrivalTile);
    }

    cancelTravel(name: string, arrivalAt: number): void {
        const key = canon(name);
        const p = this.players.get(key);
        if (!p || p.travelingUntil !== arrivalAt) return;
        p.travelingUntil = undefined;
        p.travelDestinationSector = undefined;
        p.travelDestinationTile = undefined;
        this.settledTravelKeys.delete(key);
    }

    consumeSettledTravel(name: string): boolean {
        const key = canon(name);
        if (!this.settledTravelKeys.has(key)) return false;
        this.settledTravelKeys.delete(key);
        return true;
    }

    moveToTile(name: string, tile: number): OnlinePlayer | null {
        const p = this.get(name);
        if (!p || p.inBattle || (p.travelingUntil !== undefined && p.travelingUntil > this.now())) return null;
        p.tile = tile;
        p.movementSeq = (p.movementSeq ?? 0) + 1;
        p.lastSeenAt = this.now();
        return p;
    }

    sweepStale(): OnlinePlayer[] {
        const now = this.now();
        const removed: OnlinePlayer[] = [];
        for (const [k, p] of this.players) {
            if (now - p.lastSeenAt > this.offlineAfterMs) {
                const departureSector = p.sector;
                this.settleMaturedTravel(k, p, now);
                this.players.delete(k);
                this.removeFromSector(k, p.sector);
                this.settledTravelKeys.delete(k);
                removed.push(departureSector === p.sector ? p : { ...p, departureSector });
            }
        }
        return removed;
    }

    size(): number {
        return this.players.size;
    }
}

/**
 * Process-wide singleton. Import this from the heartbeat + presence consumers.
 * On the single Railway instance every handler shares this exact map.
 */
export const onlineStore: OnlineStateStore = new MemoryOnlineStateStore();
