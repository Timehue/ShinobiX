"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onlineStore = exports.MemoryOnlineStateStore = exports.OFFLINE_AFTER_MS = void 0;
const _utils_js_1 = require("../_utils.js");
// A player is considered offline if not seen within this window. Matches the
// legacy `presence:<name>` 60s TTL so behavior is unchanged after the cutover.
exports.OFFLINE_AFTER_MS = 60_000;
// Canonical presence key = the safeName slug, matching the identity returned by
// authedPlayer and every `save:`/`user:` key, so a display name with spaces
// resolves to the same presence entry the heartbeat and kick paths use.
function canon(name) {
    return (0, _utils_js_1.safeName)(name);
}
class MemoryOnlineStateStore {
    players = new Map();
    offlineAfterMs;
    // Injectable clock so tests can advance time deterministically without sleeps.
    now;
    constructor(opts) {
        this.offlineAfterMs = opts?.offlineAfterMs ?? exports.OFFLINE_AFTER_MS;
        this.now = opts?.now ?? Date.now;
    }
    isFresh(p, now) {
        return !!p && now - p.lastSeenAt <= this.offlineAfterMs;
    }
    upsert(entry) {
        const key = canon(entry.name);
        const now = this.now();
        const prev = this.players.get(key);
        const next = {
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
    get(name) {
        const p = this.players.get(canon(name));
        return this.isFresh(p, this.now()) ? p : null;
    }
    list() {
        const now = this.now();
        const out = [];
        for (const p of this.players.values())
            if (this.isFresh(p, now))
                out.push(p);
        return out;
    }
    remove(name) {
        this.players.delete(canon(name));
    }
    setPendingAttacker(name, attacker) {
        const p = this.get(name);
        if (!p)
            return false;
        p.pendingAttacker = attacker;
        return true;
    }
    clearPendingAttacker(name) {
        const p = this.players.get(canon(name));
        if (p)
            p.pendingAttacker = null;
    }
    setInBattle(name, inBattle) {
        const p = this.players.get(canon(name));
        if (p)
            p.inBattle = inBattle ? true : undefined;
    }
    sweepStale() {
        const now = this.now();
        const removed = [];
        for (const [k, p] of this.players) {
            if (now - p.lastSeenAt > this.offlineAfterMs) {
                this.players.delete(k);
                removed.push(k);
            }
        }
        return removed;
    }
    size() {
        return this.players.size;
    }
}
exports.MemoryOnlineStateStore = MemoryOnlineStateStore;
/**
 * Process-wide singleton. Import this from the heartbeat + presence consumers.
 * On the single Railway instance every handler shares this exact map.
 */
exports.onlineStore = new MemoryOnlineStateStore();
