"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteKey = exports.MAX_ASSISTS_PER_DAY = exports.MAX_TOWER_STARTS_PER_DAY = exports.PAID_RECEIPT_TTL = exports.RUN_TOKEN_TTL = exports.TOWER_SESSION_TTL = exports.startCountKey = exports.assistCountKey = exports.assistPaidKey = exports.firstClearKey = exports.floorPaidKey = exports.runTokenKey = exports.sessionKey = void 0;
exports.utcDateKey = utcDateKey;
exports.bumpDailyStartCount = bumpDailyStartCount;
exports.storeRunToken = storeRunToken;
exports.consumeRunToken = consumeRunToken;
exports.readSession = readSession;
exports.writeSession = writeSession;
exports.setTowerInvite = setTowerInvite;
exports.getTowerInvite = getTowerInvite;
exports.clearTowerInvite = clearTowerInvite;
exports.settleFloorForMember = settleFloorForMember;
exports.settleAssistForAlly = settleAssistForAlly;
/*
 * Battle Towers — KV storage + server-authoritative reward settlement (Phase 1, P1.B).
 *
 * The security core. Hardened after an adversarial security review. Every payout is
 * fully server-authoritative:
 *   - settle takes the SERVER session (the authoritative tower:<runId> record) and
 *     re-checks completion (status 'done' + squad win) — never a client "I cleared it";
 *   - the floor + reward are resolved from the catalog BY ID (never a client floor);
 *   - the score is computed from the server session;
 *   - the one-time-first-clear gate is a PERMANENT server NX receipt
 *     (tower-firstclear:<slug>:<floor>) — NOT the client-writable battleTowerClearedFloors
 *     array, which is forgeable; the per-run receipt guards replay;
 *   - both receipts are placed INSIDE the member's failClosed save lock and rolled back
 *     if the save write fails (the receipt is on the base store, the save on the disk
 *     overlay — different backends, so rollback restores cross-store atomicity);
 *   - XP is credited through the server gainXp() (a raw char.xp += is per-level progress
 *     the client clamps away on load).
 *
 * kv / lock / now are INJECTABLE (default to the real ones) so the currency logic is
 * unit-testable with a fake in-memory store — same pattern as _lock.ts. See plan §8/§9.
 */
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _utils_js_1 = require("../_utils.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _tower_rewards_js_1 = require("./_tower-rewards.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
// ─── key scheme (all server-only; on the base Postgres store, NOT the disk overlay) ─
const sessionKey = (runId) => `tower:${runId}`;
exports.sessionKey = sessionKey;
const runTokenKey = (host, tokenId) => `tower-token:${host}:${tokenId}`;
exports.runTokenKey = runTokenKey;
const floorPaidKey = (runId, floor, slug) => `tower-paid:${runId}:${floor}:${slug}`;
exports.floorPaidKey = floorPaidKey;
const firstClearKey = (slug, floor) => `tower-firstclear:${slug}:${floor}`;
exports.firstClearKey = firstClearKey;
const assistPaidKey = (runId, slug) => `tower-assist-paid:${runId}:${slug}`;
exports.assistPaidKey = assistPaidKey;
const assistCountKey = (slug, dateKey) => `tower-assist-count:${slug}:${dateKey}`;
exports.assistCountKey = assistCountKey;
const startCountKey = (host, dateKey) => `tower-start-count:${host}:${dateKey}`;
exports.startCountKey = startCountKey;
exports.TOWER_SESSION_TTL = 30 * 60; // 30 min (refreshed on every action)
exports.RUN_TOKEN_TTL = 60 * 60; // 1 h
exports.PAID_RECEIPT_TTL = 24 * 60 * 60; // 24 h (per-run replay guard)
exports.MAX_TOWER_STARTS_PER_DAY = 60;
exports.MAX_ASSISTS_PER_DAY = 20;
function utcDateKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
/** Atomic daily mint cap (kv.incr). Returns the post-increment count; caller rejects > cap. */
async function bumpDailyStartCount(host, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    const now = deps.now ?? Date.now;
    return kv.incr((0, exports.startCountKey)(host, utcDateKey(now())), { ex: 25 * 60 * 60 });
}
async function storeRunToken(tokenId, data, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    await kv.set((0, exports.runTokenKey)(data.host, tokenId), data, { ex: exports.RUN_TOKEN_TTL });
}
/**
 * Atomically consume the run token (single-use). The DELETE is the gate: two concurrent
 * consumers both read the value, but only the one whose del removes the row wins — so a
 * token can never spawn two runs. Mirrors api/_ranked-match-token.ts (tower-token:* is on
 * the base store, so the del rowcount is authoritative).
 */
async function consumeRunToken(host, tokenId, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    const key = (0, exports.runTokenKey)(host, tokenId);
    const data = await kv.get(key);
    if (!data)
        return null;
    const removed = await kv.del(key);
    if (removed <= 0)
        return null; // lost the race — another consumer already took it
    return data;
}
// ─── live session ────────────────────────────────────────────────────────────
async function readSession(runId, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    return kv.get((0, exports.sessionKey)(runId));
}
async function writeSession(session, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    await kv.set((0, exports.sessionKey)(session.runId), session, { ex: exports.TOWER_SESSION_TTL });
}
// ─── Co-op invites — point an invited ally at the host's runId so they can join ──
const inviteKey = (slug) => `tower-invite:${slug}`;
exports.inviteKey = inviteKey;
async function setTowerInvite(allySlug, runId, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    const now = deps.now ?? Date.now;
    await kv.set((0, exports.inviteKey)(allySlug), { runId, ts: now() }, { ex: exports.TOWER_SESSION_TTL });
}
async function getTowerInvite(slug, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    const rec = await kv.get((0, exports.inviteKey)(slug));
    return rec?.runId ?? null;
}
async function clearTowerInvite(slug, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    await kv.del((0, exports.inviteKey)(slug));
}
// ─── reward credit (server-authoritative) ────────────────────────────────────
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isClearedSquadWin(session) {
    return session.status === 'done' && session.winner === 'squad';
}
function isSquadMember(session, slug) {
    return session.actors.some(a => a.side === 'squad' && a.ownerSlug === slug);
}
// Apply a first-clear reward + score to a character. The one-time gate is the SERVER
// firstClearKey NX receipt (placed by the caller) — so this ALWAYS credits when reached.
// XP is routed through the server gainXp() (levels up; raw += is clamped away on load).
// The battleTower* arrays are DISPLAY state only (the receipt is the real gate).
function creditFloorClear(char, reward, score, floorId) {
    const leveled = (0, _xp_engine_js_1.gainXp)(char, num(reward.xp));
    const cleared = Array.isArray(char.battleTowerClearedFloors) ? char.battleTowerClearedFloors : [];
    const claimed = Array.isArray(char.battleTowerClaimedRewards) ? char.battleTowerClaimedRewards : [];
    const claimKey = `floor-${floorId}`;
    return {
        ...leveled,
        ryo: num(leveled.ryo) + num(reward.ryo),
        fateShards: num(leveled.fateShards) + num(reward.fateShards),
        boneCharms: num(leveled.boneCharms) + num(reward.boneCharms),
        battleTowerClearedFloors: cleared.includes(floorId) ? cleared : [...cleared, floorId],
        battleTowerClaimedRewards: claimed.includes(claimKey) ? claimed : [...claimed, claimKey],
        battleTowerBestFloor: Math.max(num(char.battleTowerBestFloor), floorId),
        // all-time rating = sum of first-clear scores. The PERMANENT firstClearKey receipt
        // guarantees each floor adds exactly once, ever (forgery-proof).
        battleTowerRating: num(char.battleTowerRating) + Math.max(0, Math.floor(score)),
    };
}
/**
 * Settle a floor clear for ONE squad member, exactly once + one-time-forever. The handler
 * passes the SERVER session (read from tower:<runId>) and the member slug; everything else
 * is recomputed here. Pays nothing for an un-cleared session, a non-member, an unknown
 * floor, an already-paid run, or an already-first-cleared floor.
 */
async function settleFloorForMember(params, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    const lock = deps.lock ?? _lock_js_1.withKvLock;
    const now = deps.now ?? Date.now;
    const { session, slug } = params;
    if (!isClearedSquadWin(session))
        return { paid: false, reason: 'not-cleared' };
    if (!isSquadMember(session, slug))
        return { paid: false, reason: 'not-a-member' };
    const floor = (0, _floor_catalog_js_1.getFloor)(session.floor);
    if (!floor)
        return { paid: false, reason: 'no-floor' };
    const reward = (0, _tower_rewards_js_1.computeFloorReward)(floor); // sealed catalog reward
    const score = (0, _tower_rewards_js_1.computeFloorClearScore)((0, _tower_rewards_js_1.clearMetrics)(session), floor); // server-computed
    let result = { paid: false, reason: 'unknown' };
    try {
        await lock(`save:${slug}`, async () => {
            const paidReceipt = (0, exports.floorPaidKey)(session.runId, floor.id, slug);
            if (!(await kv.set(paidReceipt, { ts: now() }, { nx: true, ex: exports.PAID_RECEIPT_TTL }))) {
                result = { paid: false, reason: 'already-paid' };
                return;
            }
            const firstReceipt = (0, exports.firstClearKey)(slug, floor.id);
            const firstPlaced = await kv.set(firstReceipt, { ts: now() }, { nx: true }); // PERMANENT (no TTL)
            if (!firstPlaced) {
                result = { paid: false, reason: 'already-first-cleared', score };
                return;
            }
            const saveKey = `save:${slug}`;
            const record = await kv.get(saveKey);
            const char = record?.character;
            if (!record || !char) {
                await kv.del(paidReceipt, firstReceipt).catch(() => undefined);
                result = { paid: false, reason: 'no-save' };
                return;
            }
            const updated = creditFloorClear(char, reward, score, floor.id);
            try {
                await kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...record, character: updated }), record));
            }
            catch (e) {
                // save (disk overlay) write failed AFTER the receipts (base store) committed →
                // roll back both so the earned reward isn't permanently lost; a retry settles.
                await kv.del(paidReceipt, firstReceipt).catch(() => undefined);
                throw e;
            }
            result = { paid: true, score };
        }, { failClosed: true });
    }
    catch {
        result = { paid: false, reason: 'contended' };
    }
    return result;
}
/**
 * Settle a CAPPED assist reward for a borrowed/offline ally, once per run AND bounded by a
 * daily cap. Server-authoritative (session-verified, floor-by-id). The per-run receipt +
 * cap live inside the save lock and roll back on any non-pay so a slot isn't burned.
 */
async function settleAssistForAlly(params, deps = {}) {
    const kv = deps.kv ?? _storage_js_1.kv;
    const lock = deps.lock ?? _lock_js_1.withKvLock;
    const now = deps.now ?? Date.now;
    const { session, slug } = params;
    if (!isClearedSquadWin(session))
        return { paid: false, reason: 'not-cleared' };
    if (!isSquadMember(session, slug))
        return { paid: false, reason: 'not-a-member' };
    const floor = (0, _floor_catalog_js_1.getFloor)(session.floor);
    if (!floor)
        return { paid: false, reason: 'no-floor' };
    const reward = (0, _tower_rewards_js_1.computeAssistReward)(floor);
    let result = { paid: false, reason: 'unknown' };
    try {
        await lock(`save:${slug}`, async () => {
            const receipt = (0, exports.assistPaidKey)(session.runId, slug);
            if (!(await kv.set(receipt, { ts: now() }, { nx: true, ex: exports.PAID_RECEIPT_TTL }))) {
                result = { paid: false, reason: 'assist-already-paid' };
                return;
            }
            const count = await kv.incr((0, exports.assistCountKey)(slug, utcDateKey(now())), { ex: 25 * 60 * 60 });
            if (count > exports.MAX_ASSISTS_PER_DAY) {
                await kv.del(receipt).catch(() => undefined); // don't burn the per-run receipt on a denied cap
                result = { paid: false, reason: 'assist-daily-cap' };
                return;
            }
            const saveKey = `save:${slug}`;
            const record = await kv.get(saveKey);
            const char = record?.character;
            if (!record || !char) {
                await kv.del(receipt).catch(() => undefined);
                result = { paid: false, reason: 'no-save' };
                return;
            }
            const leveled = (0, _xp_engine_js_1.gainXp)(char, num(reward.xp));
            const claimed = Array.isArray(char.battleTowerAssistRewardsClaimed) ? char.battleTowerAssistRewardsClaimed : [];
            const updated = {
                ...leveled,
                ryo: num(leveled.ryo) + num(reward.ryo),
                battleTowerAssistRewardsClaimed: [...claimed, session.runId].slice(-500),
            };
            try {
                await kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...record, character: updated }), record));
            }
            catch (e) {
                await kv.del(receipt).catch(() => undefined);
                throw e;
            }
            result = { paid: true };
        }, { failClosed: true });
    }
    catch {
        result = { paid: false, reason: 'contended' };
    }
    return result;
}
