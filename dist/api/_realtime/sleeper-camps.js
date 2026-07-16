"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLEEPER_CAMPS_KEY = void 0;
exports.listSleeperCamps = listSleeperCamps;
exports.getSleeperCamp = getSleeperCamp;
exports.setSleeperCamp = setSleeperCamp;
exports.clearSleeperCamp = clearSleeperCamp;
exports.sleeperCampForPresence = sleeperCampForPresence;
exports.materializeSleeperCamps = materializeSleeperCamps;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("./online-store.js");
const travel_lease_js_1 = require("./travel-lease.js");
exports.SLEEPER_CAMPS_KEY = 'world:sleeper-camps';
function parseCamp(value) {
    try {
        const raw = typeof value === 'string' ? JSON.parse(value) : value;
        if (!raw || typeof raw !== 'object')
            return null;
        const camp = raw;
        const sector = Math.floor(Number(camp.sector));
        const name = (0, _utils_js_1.safeName)(String(camp.name ?? ''));
        if (!name || !Number.isFinite(sector) || sector < 1)
            return null;
        return {
            name,
            displayName: String(camp.displayName ?? camp.name ?? name),
            sector,
            createdAt: Math.max(0, Math.floor(Number(camp.createdAt ?? Date.now()))),
        };
    }
    catch {
        return null;
    }
}
async function listSleeperCamps() {
    const raw = await _storage_js_1.kv.hgetall(exports.SLEEPER_CAMPS_KEY) ?? {};
    const camps = new Map();
    for (const [field, value] of Object.entries(raw)) {
        const camp = parseCamp(value);
        if (camp)
            camps.set((0, _utils_js_1.safeName)(field), camp);
    }
    return camps;
}
async function getSleeperCamp(name) {
    return (await listSleeperCamps()).get((0, _utils_js_1.safeName)(name)) ?? null;
}
async function setSleeperCamp(camp) {
    const name = (0, _utils_js_1.safeName)(camp.name);
    if (!name || camp.sector < 1)
        return;
    await _storage_js_1.kv.hset(exports.SLEEPER_CAMPS_KEY, { [name]: { ...camp, name } });
}
async function clearSleeperCamp(name) {
    const key = (0, _utils_js_1.safeName)(name);
    if (key)
        await _storage_js_1.kv.hdel(exports.SLEEPER_CAMPS_KEY, key);
}
function sleeperCampForPresence(player, now) {
    if (player.sector < 1 || player.inBattle || (player.travelingUntil ?? 0) > now)
        return null;
    return {
        name: player.name,
        displayName: player.displayName,
        sector: player.sector,
        createdAt: now,
    };
}
/**
 * Convert timed-out live records into explicit offline camp entities. Ambient
 * disconnects become attackable sleepers; travel/fight disconnects do not mint
 * a camp until their authoritative state is safe to expose.
 */
async function materializeSleeperCamps(players) {
    const patch = {};
    const now = Date.now();
    for (const player of players) {
        const camp = sleeperCampForPresence(player, now);
        if (!camp)
            continue;
        if (online_store_js_1.onlineStore.get(player.name))
            continue;
        patch[player.name] = camp;
    }
    if (!Object.keys(patch).length)
        return;
    await _storage_js_1.kv.hset(exports.SLEEPER_CAMPS_KEY, patch);
    // A stale traveler is settled to the destination by onlineStore before it
    // reaches this function. Commit that sector to the versioned save before
    // deleting the restart-recovery lease.
    await (0, travel_lease_js_1.settleTravelLeases)(...Object.keys(patch));
    // Close the reconnect race: a heartbeat that landed while the hash write was
    // in flight wins, and its camp is removed again immediately.
    await Promise.all(Object.keys(patch).map(async (name) => {
        if (online_store_js_1.onlineStore.get(name))
            await clearSleeperCamp(name);
    }));
}
