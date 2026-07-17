"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.biomeForSettledSector = biomeForSettledSector;
exports.hollowGateRunTokenOf = hollowGateRunTokenOf;
exports.settleSaveRecord = settleSaveRecord;
exports.battleLockFlagsForPlayers = battleLockFlagsForPlayers;
exports.hollowGateRunExpiredFor = hollowGateRunExpiredFor;
exports.settleSaveRecordForRead = settleSaveRecordForRead;
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _utils_js_1 = require("./_utils.js");
const _run_token_js_1 = require("./hollow-gate/_run-token.js");
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
/** The server run token a persisted dive is bound to, if any. A run without one
 *  predates the server-authoritative loop; its liveness is unknowable from KV, so
 *  the self-heal below leaves it alone. */
function hollowGateRunTokenOf(record) {
    const char = record.character;
    if (!char || typeof char !== 'object')
        return null;
    const run = char.hollowGateRun;
    if (!run || typeof run !== 'object')
        return null;
    const token = run.runToken;
    return typeof token === 'string' && token ? token : null;
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
    let hollowGateRunCleared = false;
    let char = record.character && typeof record.character === 'object'
        ? record.character
        : null;
    // ─── Expired Hollow Gate run self-heal ────────────────────────────────────
    // The shrine is deliberately no-retreat (lib/screen-guards.ts) and the run
    // lives on the SAVE, so once the server token lapses the player is restored
    // into a gate where every action 409s — a permanent trap that previously
    // needed a manual Postgres edit to undo. Dropping the dead run here is the
    // backstop that frees them on the next read even if their client never
    // manages to post the clear.
    //
    // This grants nothing: an expired token can no longer settle, and the in-run
    // haul was never credited (the HG currencies are server-ledger fields that
    // sanitizeCharacterSave freezes for generic saves), so there is nothing to
    // pay out or claw back — only the dead run pointer goes away.
    //
    // `= undefined`, NEVER `delete`: settleSaveRecordForRead persists through
    // mergePreservingImages, which seeds from the STORED record and only
    // overrides keys present on the incoming one. A deleted key is absent, so the
    // stored run would be resurrected right back onto the save; an explicit
    // undefined is an own key that overrides, and JSON drops it on write.
    if (char && opts.hollowGateRunExpired && char.hollowGateRun != null) {
        next = cloneRecord(record);
        char = cloneCharacter(char);
        char.hollowGateRun = undefined;
        next.character = char;
        changed = true;
        hollowGateRunCleared = true;
    }
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
    return { record: next, changed, vitalsChanged, travelChanged, hollowGateRunCleared };
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
/** True when a persisted dive names a server run token that KV no longer holds —
 *  i.e. the run was settled, lost, or its 24h TTL lapsed, and every endpoint will
 *  now 409 it as expired. Costs one KV read, and only for a save that is actually
 *  mid-dive: a player with no open run never pays for this probe. A token-less
 *  legacy run returns false (unknowable — left for the player to walk out of). */
async function hollowGateRunExpiredFor(slug, record) {
    const token = hollowGateRunTokenOf(record);
    if (!slug || !token)
        return false;
    try {
        return (await _storage_js_1.kv.get((0, _run_token_js_1.hollowGateRunKey)(slug, token))) == null;
    }
    catch {
        // Fail toward KEEPING the run: a KV blip is not evidence that a dive
        // expired, and this read must never be the thing that voids a live one
        // (or 500s the save GET of a player who is merely mid-dive).
        return false;
    }
}
async function settleSaveRecordForRead(playerName, record, opts = {}) {
    const slug = (0, _utils_js_1.safeName)(playerName);
    if (!slug)
        return { record, changed: false, vitalsChanged: false, travelChanged: false, hollowGateRunCleared: false };
    const now = Math.max(0, Math.floor(opts.now ?? Date.now()));
    const [lockFlags, hollowGateRunExpired] = await Promise.all([
        battleLockFlagsForPlayers([slug]),
        hollowGateRunExpiredFor(slug, record),
    ]);
    const projected = settleSaveRecord(record, { now, battleLocked: lockFlags.get(slug) === true, hollowGateRunExpired });
    if (!opts.persist || !projected.changed)
        return projected;
    const saveKey = `save:${slug}`;
    const persisted = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
        const fresh = await _storage_js_1.kv.get(saveKey);
        if (!fresh)
            return projected;
        // Re-probe under the lock against the FRESH record: the run token it names
        // may differ from the one we read outside the lock (a dive that just
        // started, or a fresh run minted between the two reads). Re-deriving the
        // flag here keeps a live run from being cleared by a stale observation.
        const [freshFlags, freshExpired] = await Promise.all([
            battleLockFlagsForPlayers([slug]),
            hollowGateRunExpiredFor(slug, fresh),
        ]);
        const next = settleSaveRecord(fresh, { now, battleLocked: freshFlags.get(slug) === true, hollowGateRunExpired: freshExpired });
        if (!next.changed)
            return next;
        const versioned = (0, _save_version_js_1.bumpSaveVersion)(next.record);
        await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(versioned, fresh));
        return { ...next, record: versioned };
    });
    return persisted;
}
