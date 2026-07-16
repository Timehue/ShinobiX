"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTravelLease = parseTravelLease;
exports.travelLeaseKey = travelLeaseKey;
exports.travelLeaseSectorAt = travelLeaseSectorAt;
exports.sleeperSectorForTravelLease = sleeperSectorForTravelLease;
exports.getTravelLease = getTravelLease;
exports.setTravelLease = setTravelLease;
exports.settleTravelLease = settleTravelLease;
exports.settleTravelLeases = settleTravelLeases;
exports.clearTravelLeases = clearTravelLeases;
exports.clearTravelLease = clearTravelLease;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _lock_js_1 = require("../_lock.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _traces_js_1 = require("../sector/_traces.js");
const TRAVEL_LEASE_PREFIX = 'world:travel-lease:';
const TRAVEL_LEASE_TTL_SEC = 7 * 24 * 60 * 60;
function sector(value, allowSafeZone) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed))
        return null;
    if (allowSafeZone && parsed === 0)
        return 0;
    return parsed === 99 || (parsed >= 1 && parsed <= 60) ? parsed : null;
}
function parseTravelLease(value) {
    const raw = typeof value === 'string'
        ? (() => { try {
            return JSON.parse(value);
        }
        catch {
            return null;
        } })()
        : value;
    if (!raw || typeof raw !== 'object')
        return null;
    const input = raw;
    const originSector = sector(input.originSector, true);
    const destinationSector = sector(input.destinationSector, false);
    const arrivalAt = Math.floor(Number(input.arrivalAt));
    if (originSector === null || destinationSector === null || !Number.isFinite(arrivalAt) || arrivalAt <= 0)
        return null;
    const rawTile = Math.floor(Number(input.arrivalTile));
    const arrivalTile = Number.isFinite(rawTile) && rawTile >= 0 && rawTile <= 143 ? rawTile : undefined;
    return { originSector, destinationSector, arrivalAt, ...(arrivalTile === undefined ? {} : { arrivalTile }) };
}
function travelLeaseKey(name) {
    return `${TRAVEL_LEASE_PREFIX}${(0, _utils_js_1.safeName)(name)}`;
}
/** Authoritative sector while the lease is active, and after it has matured. */
function travelLeaseSectorAt(lease, now) {
    return now < lease.arrivalAt ? lease.originSector : lease.destinationSector;
}
/** A traveling disconnect is hidden; after arrival it may sleep at the destination. */
function sleeperSectorForTravelLease(lease, now) {
    return now < lease.arrivalAt ? null : lease.destinationSector;
}
async function getTravelLease(name) {
    return parseTravelLease(await _storage_js_1.kv.get(travelLeaseKey(name)));
}
async function setTravelLease(name, lease) {
    const normalized = parseTravelLease(lease);
    const key = travelLeaseKey(name);
    if (!(0, _utils_js_1.safeName)(name) || !normalized)
        throw new Error('Invalid travel lease.');
    await (0, _lock_js_1.withKvLock)(key, async () => {
        await _storage_js_1.kv.set(key, normalized, { ex: TRAVEL_LEASE_TTL_SEC });
    }, { failClosed: true });
}
function sameLease(a, b) {
    return a.originSector === b.originSector
        && a.destinationSector === b.destinationSector
        && a.arrivalAt === b.arrivalAt
        && a.arrivalTile === b.arrivalTile;
}
/** Commit a matured destination to the versioned save before deleting its lease. */
async function settleTravelLease(name, expectedLease, now = Date.now()) {
    const key = travelLeaseKey(name);
    if (!(0, _utils_js_1.safeName)(name))
        return false;
    return await (0, _lock_js_1.withKvLock)(key, async () => {
        const lease = parseTravelLease(await _storage_js_1.kv.get(key));
        if (!lease || now < lease.arrivalAt || (expectedLease && !sameLease(lease, expectedLease)))
            return false;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(name, ({ character }) => ({
            ok: true,
            character,
            value: true,
            recordPatch: { currentSector: lease.destinationSector, pendingTravel: null },
        }));
        if (!result.ok)
            return false;
        await _storage_js_1.kv.del(key);
        // Footfall trace ("N shinobi passed through today") — fire-and-forget so a
        // counter hiccup can never fail an arrival. Exactly once per settled lease.
        void _storage_js_1.kv.incr((0, _traces_js_1.footfallKey)(lease.destinationSector, now), { ex: _traces_js_1.FOOTFALL_TTL_SEC }).catch(() => undefined);
        return true;
    }, { failClosed: true });
}
async function settleTravelLeases(...names) {
    await Promise.all([...new Set(names.map(_utils_js_1.safeName).filter(Boolean))].map(async (name) => {
        await settleTravelLease(name).catch(() => false);
    }));
}
async function clearTravelLeases(...names) {
    const keys = [...new Set(names.map(travelLeaseKey).filter((key) => key !== TRAVEL_LEASE_PREFIX))];
    if (keys.length)
        await _storage_js_1.kv.del(...keys);
}
async function clearTravelLease(name) {
    await clearTravelLeases(name);
}
