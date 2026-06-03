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
 */
import type { OnlinePlayer, OnlineStateStore, PresenceUpsert } from './types.js';

// A player is considered offline if not seen within this window. Matches the
// legacy `presence:<name>` 60s TTL so behavior is unchanged after the cutover.
export const OFFLINE_AFTER_MS = 60_000;

function canon(name: string): string {
    return name.trim().toLowerCase();
}

export class MemoryOnlineStateStore implements OnlineStateStore {
    private players = new Map<string, OnlinePlayer>();
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

    upsert(entry: PresenceUpsert): OnlinePlayer {
        const key = canon(entry.name);
        const now = this.now();
        const prev = this.players.get(key);
        const next: OnlinePlayer = {
            name: key,
            displayName: entry.name,
            sector: entry.sector,
            // Fall back to the previously-stored slim character if this beat sent none.
            character: entry.character ?? prev?.character ?? null,
            lastSeenAt: now,
            connectedAt: prev?.connectedAt ?? now,
            // pendingAttacker survives a refresh — only attack/clear-attack touch it.
            pendingAttacker: prev?.pendingAttacker ?? null,
            travelingUntil: entry.travelingUntil,
            inBattle: entry.inBattle === true ? true : undefined,
        };
        this.players.set(key, next);
        return next;
    }

    get(name: string): OnlinePlayer | null {
        const p = this.players.get(canon(name));
        return this.isFresh(p, this.now()) ? p : null;
    }

    list(): OnlinePlayer[] {
        const now = this.now();
        const out: OnlinePlayer[] = [];
        for (const p of this.players.values()) if (this.isFresh(p, now)) out.push(p);
        return out;
    }

    remove(name: string): void {
        this.players.delete(canon(name));
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

    sweepStale(): string[] {
        const now = this.now();
        const removed: string[] = [];
        for (const [k, p] of this.players) {
            if (now - p.lastSeenAt > this.offlineAfterMs) {
                this.players.delete(k);
                removed.push(k);
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
