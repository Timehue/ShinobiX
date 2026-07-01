"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.biomeForSettledSector = biomeForSettledSector;
exports.settleSaveRecord = settleSaveRecord;
exports.battleLockFlagsForPlayers = battleLockFlagsForPlayers;
exports.settleSaveRecordForRead = settleSaveRecordForRead;
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _utils_js_1 = require("./_utils.js");
const _save_version_js_1 = require("./save/_save-version.js");
const AURA_SPHERE_ITEM_ID = 'aura-sphere';
const VITAL_REGEN_MS = 1000;
const BATTLE_LOCK_PREFIX = 'battle-lock:';
function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function floorEpoch(value) {
    const n = Math.floor(num(value, 0));
    return n > 0 ? n : 0;
}
function cloneRecord(record) {
    return { ...record };
}
function cloneCharacter(character) {
    return { ...character };
}
function biomeForSettledSector(sector) {
    if (sector === 99)
        return 'volcano';
    if (sector >= 56)
        return 'central';
    if (sector <= 20)
        return 'shadow';
    if (sector <= 35)
        return 'forest';
    if (sector <= 45)
        return 'volcano';
    return 'snow';
}
function pendingTravelFrom(value) {
    if (!value || typeof value !== 'object')
        return null;
    const raw = value;
    const destinationSector = Math.floor(num(raw.destinationSector ?? raw.sector, NaN));
    const arrivalAt = floorEpoch(raw.arrivalAt);
    if (!Number.isFinite(destinationSector) || destinationSector < 0 || destinationSector > 999 || !arrivalAt)
        return null;
    return { destinationSector, arrivalAt };
}
function hasActiveHollowGateRun(character) {
    const run = character.hollowGateRun;
    return Boolean(run && typeof run === 'object' && !run.completed);
}
function hasEquippedAuraSphere(character) {
    const equipment = character.equipment;
    if (!equipment || typeof equipment !== 'object')
        return false;
    const eq = equipment;
    return eq.aura === AURA_SPHERE_ITEM_ID || eq.accessory === AURA_SPHERE_ITEM_ID;
}
function auraRegenBonus(character) {
    if (!hasEquippedAuraSphere(character))
        return 0;
    const level = Math.max(1, Math.floor(num(character.auraSphereLevel, 1)));
    if (level >= 300)
        return 5;
    if (level >= 150)
        return 2;
    if (level >= 100)
        return 2;
    if (level >= 1)
        return 1;
    return 0;
}
function canRegenVitals(character, battleLocked, now) {
    if (battleLocked)
        return false;
    if (hasActiveHollowGateRun(character))
        return false;
    if (character.hospitalized === true)
        return false;
    const hospitalizedUntil = floorEpoch(character.hospitalizedUntil);
    if (hospitalizedUntil && now < hospitalizedUntil)
        return false;
    return true;
}
function regenVital(character, key, maxKey, amount) {
    const max = Math.max(0, Math.floor(num(character[maxKey], 0)));
    const current = Math.max(0, Math.floor(num(character[key], max)));
    return Math.min(max, current + amount);
}
function settleSaveRecord(record, opts = {}) {
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const battleLocked = Boolean(opts.battleLocked);
    let next = record;
    let changed = false;
    let vitalsChanged = false;
    let travelChanged = false;
    const char = record.character && typeof record.character === 'object'
        ? record.character
        : null;
    const travel = pendingTravelFrom(record.pendingTravel);
    if (travel && now >= travel.arrivalAt) {
        next = changed ? next : cloneRecord(record);
        const writable = next;
        writable.currentSector = travel.destinationSector;
        writable.currentBiome = biomeForSettledSector(travel.destinationSector);
        writable.pendingTravel = null;
        changed = true;
        travelChanged = true;
    }
    else if (!travel && record.pendingTravel != null) {
        next = changed ? next : cloneRecord(record);
        next.pendingTravel = null;
        changed = true;
        travelChanged = true;
    }
    if (char && canRegenVitals(char, battleLocked, now)) {
        const saveAt = floorEpoch(record._saveAt);
        const elapsedMs = saveAt ? Math.max(0, now - saveAt) : 0;
        const ticks = Math.floor(elapsedMs / VITAL_REGEN_MS);
        if (ticks > 0) {
            const amount = ticks * (1 + auraRegenBonus(char));
            const hp = regenVital(char, 'hp', 'maxHp', amount);
            const chakra = regenVital(char, 'chakra', 'maxChakra', amount);
            const stamina = regenVital(char, 'stamina', 'maxStamina', amount);
            if (hp !== num(char.hp, hp) || chakra !== num(char.chakra, chakra) || stamina !== num(char.stamina, stamina)) {
                next = changed ? next : cloneRecord(record);
                const nextChar = cloneCharacter(char);
                nextChar.hp = hp;
                nextChar.chakra = chakra;
                nextChar.stamina = stamina;
                const writable = next;
                writable.character = nextChar;
                writable._saveAt = now;
                changed = true;
                vitalsChanged = true;
            }
        }
    }
    return { record: next, changed, vitalsChanged, travelChanged };
}
async function battleLockFlagsForPlayers(names) {
    const slugs = [...new Set(names.map((name) => (0, _utils_js_1.safeName)(name)).filter(Boolean))];
    const flags = new Map();
    if (!slugs.length)
        return flags;
    const locks = await _storage_js_1.kv.mget(...slugs.map((slug) => `${BATTLE_LOCK_PREFIX}${slug}`));
    slugs.forEach((slug, index) => flags.set(slug, Boolean(locks[index])));
    return flags;
}
async function settleSaveRecordForRead(playerName, record, opts = {}) {
    const slug = (0, _utils_js_1.safeName)(playerName);
    if (!slug)
        return { record, changed: false, vitalsChanged: false, travelChanged: false };
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const lockFlags = await battleLockFlagsForPlayers([slug]);
    const projected = settleSaveRecord(record, { now, battleLocked: lockFlags.get(slug) === true });
    if (!opts.persist || !projected.changed)
        return projected;
    const saveKey = `save:${slug}`;
    const persisted = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
        const fresh = await _storage_js_1.kv.get(saveKey);
        if (!fresh)
            return projected;
        const freshFlags = await battleLockFlagsForPlayers([slug]);
        const next = settleSaveRecord(fresh, { now, battleLocked: freshFlags.get(slug) === true });
        if (!next.changed)
            return next;
        const versioned = (0, _save_version_js_1.bumpSaveVersion)(next.record);
        await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(versioned, fresh));
        return { ...next, record: versioned };
    });
    return persisted;
}
