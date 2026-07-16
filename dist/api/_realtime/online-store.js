"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onlineStore = exports.MemoryOnlineStateStore = exports.OFFLINE_AFTER_MS = void 0;
const _utils_js_1 = require("../_utils.js");
// A player is considered offline if not seen within this window. Clients keepalive
// every ~20s (socket ping + HTTP reconcile), so a 60s window evicts an active peer
// after a SINGLE missed beat — the root of the sector "pop in/out" flicker. 90s
// tolerates ~4 missed beats (background-tab throttling, a transient socket drop,
// latency) before a live player is dropped from everyone's sector, while still
// clearing a genuinely-closed tab within a beat or two of a minute.
exports.OFFLINE_AFTER_MS = 90_000;
// Canonical presence key = the safeName slug, matching the identity returned by
// authedPlayer and every `save:`/`user:` key, so a display name with spaces
// resolves to the same presence entry the heartbeat and kick paths use.
function canon(name) {
    return (0, _utils_js_1.safeName)(name);
}
class MemoryOnlineStateStore {
    players = new Map();
    sectors = new Map();
    settledTravelKeys = new Set();
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
    addToSector(key, sector) {
        const names = this.sectors.get(sector) ?? new Set();
        names.add(key);
        this.sectors.set(sector, names);
    }
    removeFromSector(key, sector) {
        const names = this.sectors.get(sector);
        if (!names)
            return;
        names.delete(key);
        if (!names.size)
            this.sectors.delete(sector);
    }
    settleMaturedTravel(key, player, now) {
        if (player.travelDestinationSector === undefined || player.travelingUntil === undefined || now < player.travelingUntil)
            return;
        const previousSector = player.sector;
        player.sector = player.travelDestinationSector;
        if (player.travelDestinationTile !== undefined)
            player.tile = player.travelDestinationTile;
        player.travelingUntil = undefined;
        player.travelDestinationSector = undefined;
        player.travelDestinationTile = undefined;
        this.settledTravelKeys.add(key);
        if (previousSector !== player.sector) {
            this.removeFromSector(key, previousSector);
            this.addToSector(key, player.sector);
        }
    }
    applyTravel(key, player, destinationSector, arrivalAt, originSector, arrivalTile) {
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
    upsert(entry) {
        const key = canon(entry.name);
        const now = this.now();
        const prev = this.players.get(key);
        if (prev)
            this.settleMaturedTravel(key, prev, now);
        let sector = entry.sector;
        let travelingUntil = prev?.travelingUntil;
        let travelDestinationSector = prev?.travelDestinationSector;
        let travelDestinationTile = prev?.travelDestinationTile;
        if (prev) {
            // Presence is no longer allowed to teleport a live session. A sector
            // change must either be a safe-zone exit (sector 0) or the matured
            // destination of a lease minted by /player/travel.
            sector = prev.sector;
            if (entry.sector === 0) {
                if (travelingUntil !== undefined || travelDestinationSector !== undefined)
                    this.settledTravelKeys.add(key);
                sector = 0;
                travelingUntil = undefined;
                travelDestinationSector = undefined;
                travelDestinationTile = undefined;
            }
            else if (entry.sector === prev.sector) {
                // ordinary presence refresh
            }
            else if (travelDestinationSector === entry.sector
                && travelingUntil !== undefined
                && now >= travelingUntil) {
                sector = entry.sector;
                if (travelDestinationTile !== undefined)
                    entry.tile = travelDestinationTile;
                travelingUntil = undefined;
                travelDestinationSector = undefined;
                travelDestinationTile = undefined;
                this.settledTravelKeys.add(key);
            }
        }
        const next = {
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
        if (prev && prev.sector !== next.sector)
            this.removeFromSector(key, prev.sector);
        this.players.set(key, next);
        this.addToSector(key, next.sector);
        return next;
    }
    get(name) {
        const key = canon(name);
        const p = this.players.get(key);
        const now = this.now();
        if (!this.isFresh(p, now))
            return null;
        this.settleMaturedTravel(key, p, now);
        return p;
    }
    list() {
        const now = this.now();
        const out = [];
        for (const [key, p] of this.players) {
            if (!this.isFresh(p, now))
                continue;
            this.settleMaturedTravel(key, p, now);
            out.push(p);
        }
        return out;
    }
    listSector(sector) {
        const now = this.now();
        const names = this.sectors.get(sector);
        if (!names)
            return [];
        const out = [];
        for (const key of names) {
            const player = this.players.get(key);
            if (this.isFresh(player, now))
                out.push(player);
        }
        return out;
    }
    remove(name) {
        const key = canon(name);
        const player = this.players.get(key);
        if (player)
            this.removeFromSector(key, player.sector);
        this.players.delete(key);
        this.settledTravelKeys.delete(key);
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
    startTravel(name, destinationSector, arrivalAt, originSector, arrivalTile) {
        const key = canon(name);
        const p = this.get(name);
        if (!p || p.inBattle || (p.travelingUntil !== undefined && p.travelingUntil > this.now()))
            return null;
        return this.applyTravel(key, p, destinationSector, arrivalAt, originSector, arrivalTile);
    }
    restoreTravel(name, destinationSector, arrivalAt, originSector, arrivalTile) {
        const key = canon(name);
        const p = this.players.get(key);
        if (!p)
            return null;
        return this.applyTravel(key, p, destinationSector, arrivalAt, originSector, arrivalTile);
    }
    cancelTravel(name, arrivalAt) {
        const key = canon(name);
        const p = this.players.get(key);
        if (!p || p.travelingUntil !== arrivalAt)
            return;
        p.travelingUntil = undefined;
        p.travelDestinationSector = undefined;
        p.travelDestinationTile = undefined;
        this.settledTravelKeys.delete(key);
    }
    consumeSettledTravel(name) {
        const key = canon(name);
        if (!this.settledTravelKeys.has(key))
            return false;
        this.settledTravelKeys.delete(key);
        return true;
    }
    moveToTile(name, tile) {
        const p = this.get(name);
        if (!p || p.inBattle || (p.travelingUntil !== undefined && p.travelingUntil > this.now()))
            return null;
        p.tile = tile;
        p.movementSeq = (p.movementSeq ?? 0) + 1;
        p.lastSeenAt = this.now();
        return p;
    }
    sweepStale() {
        const now = this.now();
        const removed = [];
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
