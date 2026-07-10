"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stampPresenceBeat = stampPresenceBeat;
exports.isPlayerOnline = isPlayerOnline;
/*
 * Cross-worker presence fallback.
 *
 * The live roster is the in-process onlineStore (authoritative on the
 * single-process Railway host — the documented deployment invariant, see
 * online-store.ts). This adds a THROTTLED, durable KV "last seen" beat so
 * consumers that must stay correct even if presence ever splits across workers
 * (the Kage accept-obligation clock) can confirm a player is online without
 * depending on which worker handled their heartbeat.
 *
 * It is NOT the roster (that stays in memory for O(1) reads) and is deliberately
 * throttled to at most one write per PRESENCE_BEAT_THROTTLE_MS per player per
 * worker (~1.3/min, vs the ~60/min heartbeat), so it never reintroduces the
 * per-second DB write the online store was built to remove. This is the light
 * KV version of the "swap in a Redis-backed store" note in online-store.ts.
 */
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("./online-store.js");
const PRESENCE_BEAT_THROTTLE_MS = 45_000;
// TTL = the same freshness window the in-memory store uses, so mere existence of
// the key means "seen within the online window". Throttle (45s) < TTL (90s), so a
// still-online player always has a live beat with room for a missed refresh.
const PRESENCE_BEAT_TTL_SEC = Math.ceil(online_store_js_1.OFFLINE_AFTER_MS / 1000);
const lastLocalWrite = new Map();
function beatKey(name) {
    return `presence-beat:${(0, _utils_js_1.safeName)(name)}`;
}
/** Throttled durable beat. Call from every presence ingress (heartbeat + socket). */
function stampPresenceBeat(name) {
    const key = (0, _utils_js_1.safeName)(name);
    if (!key)
        return;
    const now = Date.now();
    if (now - (lastLocalWrite.get(key) ?? 0) < PRESENCE_BEAT_THROTTLE_MS)
        return;
    lastLocalWrite.set(key, now);
    void _storage_js_1.kv.set(beatKey(key), now, { ex: PRESENCE_BEAT_TTL_SEC }).catch(() => undefined);
}
/**
 * Is the player online right now, correct across workers? Fast path: the local
 * in-memory store (authoritative on single-process, zero I/O). Fallback: the
 * durable beat (covers the case where the heartbeat landed on a different worker).
 */
async function isPlayerOnline(name) {
    if (!name)
        return false;
    if (online_store_js_1.onlineStore.get(name))
        return true;
    try {
        return !!(await _storage_js_1.kv.get(beatKey(name)));
    }
    catch {
        return false;
    }
}
