"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const node_crypto_1 = require("node:crypto");
const QUEUE_KEY = 'card-clash:queue';
const KV_TTL_SECONDS = 2 * 60 * 60;
const STALE_MS = 60 * 1000; // entries older than this must re-queue
const MATCH_TTL_SECONDS = 45; // per-player pairing record (poll handoff)
const PAIR_TTL_SECONDS = 5 * 60; // shared match-auth record (join window)
const matchKey = (slug) => `${QUEUE_KEY}:match:${slug}`;
const pairKey = (matchId) => `cc-pair:${matchId}`;
// Level band — mirrors pet-ranked-queue.ts; widens with the caller's wait so a
// sparse queue eventually pairs anyone, but the first pass prefers same-level.
const LEVEL_BAND_BASE = 10;
const LEVEL_BAND_OPEN_INTERVAL_MS = 15_000;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        const name = typeof req.query.name === 'string' ? (0, _utils_js_1.safeName)(req.query.name) : '';
        const queue = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
        const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ inQueue: active.some(e => e.name === name), queueSize: active.length });
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, action } = body;
            if (!name || !action)
                return res.status(400).json({ error: 'Missing name or action.' });
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name)) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }
            // ~60/min covers a ~2-3s poll cadence; without it spam serializes on the
            // shared QUEUE_KEY lock and degrades matchmaking latency for everyone.
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'card-clash-queue', 60, 60_000, identity.name)))
                return;
            // Pre-derive level from the save before the lock so the lock body stays fast.
            let serverLevel = 1;
            if (action === 'join' && !identity.admin) {
                try {
                    const save = await _storage_js_1.kv.get(`save:${identity.name}`);
                    const char = (save?.character ?? null);
                    if (char && typeof char.level === 'number')
                        serverLevel = char.level;
                }
                catch { /* best-effort; default applies */ }
            }
            const out = await (0, _lock_js_1.withKvLock)(QUEUE_KEY, async () => {
                const queue = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
                const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
                const slug = (0, _utils_js_1.safeName)(name);
                if (action === 'leave') {
                    const filtered = active.filter(e => e.name !== slug);
                    await Promise.all([
                        _storage_js_1.kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        _storage_js_1.kv.del(matchKey(slug)),
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: filtered.length, match: null } };
                }
                if (action === 'join') {
                    const filtered = active.filter(e => e.name !== slug);
                    filtered.push({ name: slug, level: serverLevel, joinedAt: Date.now() });
                    await Promise.all([
                        _storage_js_1.kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        _storage_js_1.kv.del(matchKey(slug)), // clear any stale prior pairing
                    ]);
                    return { status: 200, body: { inQueue: true, queueSize: filtered.length, match: null } };
                }
                if (action === 'poll') {
                    // If a prior poll (mine OR the opponent's) already paired me, return
                    // that durable match so the side that didn't pair first still gets it.
                    const myMatch = await _storage_js_1.kv.get(matchKey(slug));
                    if (myMatch)
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: myMatch } };
                    const me = active.find(e => e.name === slug);
                    if (!me)
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };
                    const others = active.filter(e => e.name !== me.name);
                    if (others.length === 0) {
                        const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                        await _storage_js_1.kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { status: 200, body: { inQueue: true, queueSize: active.length, match: null } };
                    }
                    const waitMs = Math.max(0, Date.now() - me.joinedAt);
                    const band = LEVEL_BAND_BASE + Math.floor(waitMs / LEVEL_BAND_OPEN_INTERVAL_MS);
                    const inBand = others.filter(e => Math.abs(e.level - me.level) <= band);
                    const candidates = inBand.length > 0 ? inBand : others;
                    candidates.sort((a, b) => Math.abs(a.level - me.level) - Math.abs(b.level - me.level));
                    const opponent = candidates[0];
                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                    // Deterministic slot assignment: the lexicographically smaller slug
                    // is p1 (opens the match session), the other is p2 (joins).
                    const matchId = (0, node_crypto_1.randomUUID)();
                    const p1Name = me.name < opponent.name ? me.name : opponent.name;
                    const p2Name = me.name < opponent.name ? opponent.name : me.name;
                    const now = Date.now();
                    const matchForMe = { matchId, opponent: opponent.name, p1: me.name === p1Name, createdAt: now };
                    const matchForOpp = { matchId, opponent: me.name, p1: opponent.name === p1Name, createdAt: now };
                    await Promise.all([
                        _storage_js_1.kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        _storage_js_1.kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        _storage_js_1.kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                        // Shared auth record the match handler reads to gate joins.
                        _storage_js_1.kv.set(pairKey(matchId), { matchId, p1Name, p2Name, createdAt: now }, { ex: PAIR_TTL_SECONDS }),
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
                }
                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json(out.body);
        }
        catch (err) {
            console.error('[card-clash/queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
