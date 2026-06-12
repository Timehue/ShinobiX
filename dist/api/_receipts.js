"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECEIPT_TTL_SEC = void 0;
exports.receiptKey = receiptKey;
exports.receiptWroteKey = receiptWroteKey;
exports.buildBattleReceipt = buildBattleReceipt;
exports.writeBattleReceipt = writeBattleReceipt;
exports.readBattleReceipt = readBattleReceipt;
exports.mergeSettlement = mergeSettlement;
exports.patchBattleSettlement = patchBattleSettlement;
exports.actionSeqKey = actionSeqKey;
exports.actionTokenKey = actionTokenKey;
exports.actionReceiptKey = actionReceiptKey;
exports.actionReceiptPattern = actionReceiptPattern;
exports.buildActionReceipt = buildActionReceipt;
exports.writeActionReceipt = writeActionReceipt;
exports.readActionReceipts = readActionReceipts;
const _storage_js_1 = require("./_storage.js");
// ─── Durable battle receipts ──────────────────────────────────────────────────
//
// The live PvP combat log (`session.log`) is capped and dies with the session's
// 15-min KV TTL, so once a fight is over there is no record left to debug a
// support ticket, verify a disputed reward, or audit an outcome. A *receipt* is
// a compact, durable snapshot written ONCE when a battle resolves, keyed by
// battleId and kept for 90 days — long enough to settle almost any player
// dispute, still tiny storage.
//
// This is purely additive observability: the receipt is derived from the
// already-finalized session and never feeds back into combat resolution. The
// write is best-effort and idempotent (a per-battle NX marker), so it can never
// double-write or break the combat path. Gate off with DISABLE_COMBAT_RECEIPTS=1.
//
//   receipt:battle:<battleId>   — the BattleReceipt JSON (90d TTL)
//   receipt:wrote:<battleId>    — NX idempotency marker (90d TTL)
const RECEIPT_PREFIX = 'receipt:battle:';
const WROTE_PREFIX = 'receipt:wrote:';
// 90 days. Receipts are small (a few KB) and only one per finished battle, so
// the retention cost is negligible; the long window means a player can dispute
// an outcome weeks later and the evidence still exists.
exports.RECEIPT_TTL_SEC = 90 * 24 * 60 * 60;
function receiptKey(battleId) { return `${RECEIPT_PREFIX}${battleId}`; }
function receiptWroteKey(battleId) { return `${WROTE_PREFIX}${battleId}`; }
function fighterReceipt(f) {
    return {
        name: String(f.name ?? ''),
        hp: Math.max(0, Math.round(Number(f.hp) || 0)),
        maxHp: Math.round(Number(f.maxHp) || 0),
        finalStatuses: (Array.isArray(f.statuses) ? f.statuses : []).map((s) => ({
            name: String(s.name ?? ''),
            rounds: Number(s.rounds) || 0,
        })),
    };
}
// Pure: derive the durable receipt from a finalized session. No I/O, no clock —
// `now` is passed so callers (and tests) control the timestamp.
function buildBattleReceipt(session, now) {
    return {
        battleId: String(session.battleId ?? ''),
        ranked: session.ranked === true,
        rankedKind: session.rankedKind,
        startedAt: Number(session.createdAt) || 0,
        endedAt: now,
        rounds: Number(session.round) || 0,
        p1: fighterReceipt(session.p1),
        p2: fighterReceipt(session.p2),
        winner: session.winner ?? null,
        fleedBy: session.fleedBy,
        p1Rating: session.p1Rating,
        p2Rating: session.p2Rating,
        log: Array.isArray(session.log) ? [...session.log] : [],
        settlement: undefined,
    };
}
function receiptsDisabled() {
    return process.env.DISABLE_COMBAT_RECEIPTS === '1';
}
// Write the durable receipt exactly once for a resolved battle. Best-effort and
// idempotent: a per-battle NX marker means a retried terminal move (or a replay)
// never double-writes, and any storage hiccup is swallowed so the combat path is
// never affected. No-op for unresolved sessions or when receipts are disabled.
async function writeBattleReceipt(session, opts = {}) {
    if (receiptsDisabled())
        return false;
    if (!session?.battleId || session.status !== 'done')
        return false;
    const store = opts.kv ?? _storage_js_1.kv;
    const now = opts.now ?? Date.now();
    try {
        const placed = await store.set(receiptWroteKey(session.battleId), { ts: now }, { nx: true, ex: exports.RECEIPT_TTL_SEC });
        if (!placed)
            return false; // already written for this battle
        await store.set(receiptKey(session.battleId), buildBattleReceipt(session, now), { ex: exports.RECEIPT_TTL_SEC });
        return true;
    }
    catch {
        // best-effort — never break the caller
        return false;
    }
}
async function readBattleReceipt(battleId, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    try {
        return await store.get(receiptKey(battleId));
    }
    catch {
        return null;
    }
}
// Pure: merge a settlement patch onto an existing receipt. Last-writer-wins on
// individual fields, which is benign for this debug-only summary (the winner's
// claim writes ryo/xp/ratingDelta; the loser's writes their ratingDelta).
function mergeSettlement(existing, patch, now) {
    const settlement = {
        ...(existing.settlement ?? {}),
        ...patch,
        settledAt: patch.settledAt ?? existing.settlement?.settledAt ?? now,
    };
    return { ...existing, settlement };
}
// Patch the server-credited settlement summary onto a battle's receipt. Runs
// AFTER the reward is actually credited; best-effort, never throws into the
// reward path. No-op if the receipt doesn't exist (e.g. receipts disabled).
async function patchBattleSettlement(battleId, patch, opts = {}) {
    if (receiptsDisabled())
        return;
    const store = opts.kv ?? _storage_js_1.kv;
    const now = opts.now ?? Date.now();
    try {
        const existing = await store.get(receiptKey(battleId));
        if (!existing)
            return;
        await store.set(receiptKey(battleId), mergeSettlement(existing, patch, now), { ex: exports.RECEIPT_TTL_SEC });
    }
    catch {
        // best-effort
    }
}
function actionSeqKey(battleId) { return `receipt:seq:${battleId}`; }
function actionTokenKey(battleId, token) {
    return `receipt:act-tok:${battleId}:${token}`;
}
// Zero-padded seq so a lexical key sort == numeric order. A battle caps at
// MAX_ROUNDS × MAX_ACTIONS × 2 fighters (~250 actions), far under 999999.
function actionReceiptKey(battleId, seq) {
    return `receipt:action:${battleId}:${String(seq).padStart(6, '0')}`;
}
function actionReceiptPattern(battleId) {
    return `receipt:action:${battleId}:*`;
}
// Compact delta of the vitals that changed. Rounds to integers and drops zeros.
function vitalsDelta(before, after) {
    const d = {};
    const hp = Math.round((Number(after.hp) || 0) - (Number(before.hp) || 0));
    const chakra = Math.round((Number(after.chakra) || 0) - (Number(before.chakra) || 0));
    const stamina = Math.round((Number(after.stamina) || 0) - (Number(before.stamina) || 0));
    const shield = Math.round((Number(after.shield) || 0) - (Number(before.shield) || 0));
    const pos = (Number(after.pos) || 0) - (Number(before.pos) || 0);
    if (hp)
        d.hp = hp;
    if (chakra)
        d.chakra = chakra;
    if (stamina)
        d.stamina = stamina;
    if (shield)
        d.shield = shield;
    if (pos)
        d.pos = pos;
    return d;
}
// Pure: derive an ActionReceipt from the pre/post session + action metadata.
// `summaryLines` is the suffix of post.log beyond pre.log — every commit path
// builds post.log as [...pre.log, ...thisActionsLines], and the receipt is
// written BEFORE the log is trimmed, so the suffix is exactly this action's
// narrative (flavor/cast line first, then effect lines). No I/O, no clock.
function buildActionReceipt(input, seq, now) {
    const { pre, post, role } = input;
    const targetRole = role === 'p1' ? 'p2' : 'p1';
    const actorBefore = role === 'p1' ? pre.p1 : pre.p2;
    const actorAfter = role === 'p1' ? post.p1 : post.p2;
    const targetBefore = targetRole === 'p1' ? pre.p1 : pre.p2;
    const targetAfter = targetRole === 'p1' ? post.p1 : post.p2;
    const preLen = Array.isArray(pre.log) ? pre.log.length : 0;
    const summaryLines = (Array.isArray(post.log) ? post.log.slice(preLen) : []).map(String);
    const apSpent = (Number(pre.ap?.[role]) || 0) - (Number(post.ap?.[role]) || 0);
    const result = post.status === 'done' ? 'battle_end' : 'applied';
    return {
        battleId: String(pre.battleId ?? ''),
        seq,
        moveToken: input.moveToken,
        round: Number(pre.round) || 0,
        actorRole: role,
        actorName: String(actorBefore.name ?? ''),
        targetRole,
        targetName: String(targetBefore.name ?? ''),
        actionId: input.actionId,
        actionName: input.actionName,
        actionType: input.actionType,
        result,
        summaryLines,
        actorDelta: vitalsDelta(actorBefore, actorAfter),
        targetDelta: vitalsDelta(targetBefore, targetAfter),
        apSpent: apSpent > 0 ? apSpent : undefined,
        winner: post.status === 'done' ? (post.winner ?? null) : undefined,
        createdAt: now,
    };
}
// Append one durable receipt for a committed action. Best-effort + idempotent:
// a per-moveToken NX marker means a retried move (the move handler already
// short-circuits known tokens, but guard here too) never double-appends, and any
// storage hiccup is swallowed so the combat path is never affected. No-op when
// receipts are disabled or the session has no battleId.
async function writeActionReceipt(input, opts = {}) {
    if (receiptsDisabled())
        return null;
    const battleId = String(input.pre?.battleId ?? '');
    if (!battleId)
        return null;
    const store = opts.kv ?? _storage_js_1.kv;
    const now = opts.now ?? Date.now();
    try {
        if (input.moveToken) {
            const placed = await store.set(actionTokenKey(battleId, input.moveToken), { ts: now }, { nx: true, ex: exports.RECEIPT_TTL_SEC });
            if (!placed)
                return null; // already recorded this move
        }
        const seq = await store.incr(actionSeqKey(battleId), { ex: exports.RECEIPT_TTL_SEC });
        const receipt = buildActionReceipt(input, seq, now);
        await store.set(actionReceiptKey(battleId, seq), receipt, { ex: exports.RECEIPT_TTL_SEC });
        return receipt;
    }
    catch {
        // best-effort — never break the caller
        return null;
    }
}
// Read every per-action receipt for a battle, ordered by seq. Used by the
// combat-log endpoint. Best-effort: returns [] on any storage error.
async function readActionReceipts(battleId, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    try {
        const keys = await store.keys(actionReceiptPattern(battleId));
        if (!keys.length)
            return [];
        keys.sort();
        const vals = await store.mget(...keys);
        return vals
            .filter((v) => !!v && typeof v === 'object')
            .sort((a, b) => a.seq - b.seq);
    }
    catch {
        return [];
    }
}
