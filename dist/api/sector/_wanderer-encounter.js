"use strict";
/*
 * Shared server-side guard for natural sector wanderers.
 *
 * The client renders natural wanderers with ids shaped like:
 *   w-<homeSector>-<sixHourBucket>-<rosterIndex>
 *
 * Legacy Sage / Legacy Emissary NPCs use synthetic ids and intentionally do not
 * enter this cooldown/relocation path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WANDERER_SECTOR_COUNT = exports.WANDERER_ENCOUNTER_COOLDOWN_SECONDS = exports.WANDERER_ENCOUNTER_COOLDOWN_MS = void 0;
exports.parseNaturalWandererId = parseNaturalWandererId;
exports.wandererDayBucketFromMs = wandererDayBucketFromMs;
exports.wandererUseCooldownKey = wandererUseCooldownKey;
exports.currentWandererCooldownUntil = currentWandererCooldownUntil;
exports.pruneWandererCooldownsForSave = pruneWandererCooldownsForSave;
exports.pruneWandererMovesForSave = pruneWandererMovesForSave;
exports.wandererRelocationSector = wandererRelocationSector;
exports.withWandererUseState = withWandererUseState;
exports.claimWandererUseCooldown = claimWandererUseCooldown;
const _utils_js_1 = require("../_utils.js");
exports.WANDERER_ENCOUNTER_COOLDOWN_MS = 3 * 60 * 60 * 1000;
exports.WANDERER_ENCOUNTER_COOLDOWN_SECONDS = Math.ceil(exports.WANDERER_ENCOUNTER_COOLDOWN_MS / 1000);
exports.WANDERER_SECTOR_COUNT = 60;
function parseNaturalWandererId(id) {
    const m = /^w-(\d+)-(\d+)-(\d+)$/.exec(String(id ?? ''));
    if (!m)
        return null;
    return { sector: Number(m[1]), dayBucket: Number(m[2]), index: Number(m[3]) };
}
function wandererDayBucketFromMs(nowMs) {
    return Math.floor(nowMs / (6 * 60 * 60 * 1000));
}
function wandererUseCooldownKey(playerName, wandererId) {
    return `wanderer-use:${playerName}:${wandererId}`;
}
function num(v) {
    return Number.isFinite(Number(v)) ? Number(v) : 0;
}
function record(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function currentWandererCooldownUntil(character, wandererId, nowMs) {
    const cooldowns = record(character.wandererCooldowns);
    const until = num(cooldowns[wandererId]);
    return until > nowMs ? until : null;
}
function pruneWandererCooldownsForSave(cooldowns, nowMs) {
    const out = {};
    for (const [id, rawUntil] of Object.entries(record(cooldowns))) {
        const until = num(rawUntil);
        if (until > nowMs)
            (0, _utils_js_1.setSafeRecordValue)(out, id, until);
    }
    return out;
}
function pruneWandererMovesForSave(moves, currentDayBucket) {
    const out = {};
    for (const [id, rawSector] of Object.entries(record(moves))) {
        const parsed = parseNaturalWandererId(id);
        const sector = Math.floor(num(rawSector));
        if (!parsed || parsed.dayBucket !== currentDayBucket)
            continue;
        if (sector >= 1 && sector <= exports.WANDERER_SECTOR_COUNT)
            (0, _utils_js_1.setSafeRecordValue)(out, id, sector);
    }
    return out;
}
function wandererRelocationSector(wandererId, fromSector, maxSector = exports.WANDERER_SECTOR_COUNT) {
    const from = Math.max(1, Math.min(maxSector, Math.floor(num(fromSector)) || 1));
    let h = 2166136261 >>> 0;
    const key = `${wandererId}#${from}`;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const span = Math.max(1, maxSector - 1);
    let dest = 1 + ((h >>> 0) % span);
    if (dest >= from)
        dest += 1;
    return Math.max(1, Math.min(maxSector, dest));
}
function withWandererUseState(character, wandererId, nowMs, fromSector) {
    const parsed = parseNaturalWandererId(wandererId);
    if (!parsed) {
        throw new Error('withWandererUseState requires a natural wanderer id.');
    }
    const cooldownUntil = nowMs + exports.WANDERER_ENCOUNTER_COOLDOWN_MS;
    const bucket = wandererDayBucketFromMs(nowMs);
    const cooldowns = pruneWandererCooldownsForSave(character.wandererCooldowns, nowMs);
    cooldowns[wandererId] = cooldownUntil;
    const moves = pruneWandererMovesForSave(character.wandererMoves, bucket);
    const sourceSector = Math.max(1, Math.floor(num(fromSector)) || parsed.sector);
    const moveToSector = wandererRelocationSector(wandererId, sourceSector);
    moves[wandererId] = moveToSector;
    return {
        character: { ...character, wandererCooldowns: cooldowns, wandererMoves: moves },
        cooldownUntil,
        moveToSector,
    };
}
async function claimWandererUseCooldown(kv, playerName, wandererId, nowMs) {
    if (!parseNaturalWandererId(wandererId))
        return { ok: false, reason: 'invalid-wanderer' };
    const key = wandererUseCooldownKey(playerName, wandererId);
    const existing = await kv.get(key);
    const existingUntil = typeof existing === 'number' ? existing : num(existing?.cooldownUntil);
    if (existingUntil > nowMs) {
        return { ok: false, reason: 'cooldown', cooldownUntil: existingUntil };
    }
    const cooldownUntil = nowMs + exports.WANDERER_ENCOUNTER_COOLDOWN_MS;
    const claimed = await kv.set(key, { cooldownUntil }, {
        ex: exports.WANDERER_ENCOUNTER_COOLDOWN_SECONDS,
        nx: true,
    });
    if (claimed === 'OK')
        return { ok: true, cooldownUntil };
    const raced = await kv.get(key);
    const racedUntil = typeof raced === 'number' ? raced : num(raced?.cooldownUntil);
    return { ok: false, reason: 'cooldown', cooldownUntil: racedUntil > nowMs ? racedUntil : undefined };
}
