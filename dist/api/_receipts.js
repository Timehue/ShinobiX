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
