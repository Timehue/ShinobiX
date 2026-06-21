"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _ranked_match_token_js_1 = require("../_ranked-match-token.js");
const presence_gating_js_1 = require("../_realtime/presence-gating.js");
const QUEUE_KEY = 'pvp:ranked-queue';
const KV_TTL_SECONDS = 2 * 60 * 60; // 2-hour TTL
const STALE_MS = 60 * 1000; // Remove entries older than 60s (must re-queue)
// Durable per-player match record (audit #10). When two players are matched,
// BOTH get one — so the player who didn't poll first still discovers the match
// on their next poll instead of silently vanishing from the queue. Short TTL so
// a match that never turns into a fight re-opens matchmaking for both sides.
const MATCH_TTL_SECONDS = 30;
const matchKey = (slug) => `${QUEUE_KEY}:match:${slug}`;
// Matchmaking level band. Without this, the queue paired purely by Elo
// proximity — a level-5 player and a level-100 player with default 1000 Elo
// would match, which guaranteed the low-level player a free loss. Opens
// linearly with wait time (joinedAt → now) so a niche level stays matchable;
// after ~LEVEL_BAND_OPEN_INTERVAL_MS × LEVEL_BAND_MAX_STEPS the band is wide
// enough to match anyone. Falls back to "any opponent" once the band fully
// opens, so the queue never starves.
const LEVEL_BAND_BASE = 10;
const LEVEL_BAND_OPEN_INTERVAL_MS = 15_000; // widen by 1 level every 15s waiting
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        // Return queue status for a specific player (don't expose other names)
        const name = typeof req.query.name === 'string' ? (0, _utils_js_1.safeName)(req.query.name) : '';
        const queue = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
        const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
        const inQueue = active.some(e => e.name === name);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ inQueue, queueSize: active.length });
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, action } = body;
            if (!name || !action)
                return res.status(400).json({ error: 'Missing name or action.' });
            // Require auth, body name must match identity.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name)) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }
            // Throttle join/leave/poll per identity (keyed on name, not raw IP, so
            // two players behind one NAT aren't starved). Every other PvP write path
            // is rate-limited; without this, spam serializes on the shared QUEUE_KEY
            // lock and degrades matchmaking latency for everyone. ~60/min comfortably
            // covers the client's ~2-3s poll cadence with headroom.
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'ranked-queue', 60, 60_000, identity.name)))
                return;
            // Pre-derive server-side level/elo for the join path before
            // entering the lock so the lock body stays fast.
            let serverLevel = 1;
            let serverElo = 1000;
            if (action === 'join' && !identity.admin) {
                try {
                    const save = await _storage_js_1.kv.get(`save:${identity.name}`);
                    const char = (save?.character ?? null);
                    if (char) {
                        if (typeof char.level === 'number')
                            serverLevel = char.level;
                        if (typeof char.rankedRating === 'number')
                            serverElo = char.rankedRating;
                        else if (typeof char.elo === 'number')
                            serverElo = char.elo;
                    }
                }
                catch {
                    // best-effort; defaults apply
                }
                // #4 newcomer protection: sub-floor shinobi can't enter ranked —
                // it would match them against far stronger players for a free loss.
                // Gated on the authoritative save level read just above.
                if ((0, presence_gating_js_1.isBelowAttackableFloor)(serverLevel)) {
                    return res.status(403).json({
                        error: `You must reach level ${presence_gating_js_1.ATTACKABLE_MIN_LEVEL} before entering ranked battles.`,
                    });
                }
            }
            // Serialize join/leave/poll against the shared QUEUE_KEY blob so
            // two concurrent writers can't get→filter→push→set and silently
            // drop one of the writes. Self-healing on next poll (the dropped
            // entry re-queues), so this is defense-in-depth.
            const out = await (0, _lock_js_1.withKvLock)(QUEUE_KEY, async () => {
                const queue = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
                const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
                if (action === 'leave') {
                    const filtered = active.filter(e => e.name !== (0, _utils_js_1.safeName)(name));
                    await Promise.all([
                        _storage_js_1.kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        _storage_js_1.kv.del(matchKey((0, _utils_js_1.safeName)(name))), // drop any pending match too
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: filtered.length, match: null } };
                }
                if (action === 'join') {
                    // Remove existing entry for this player, then add fresh
                    const filtered = active.filter(e => e.name !== (0, _utils_js_1.safeName)(name));
                    const entry = {
                        name: (0, _utils_js_1.safeName)(name),
                        level: serverLevel,
                        elo: serverElo,
                        joinedAt: Date.now(),
                    };
                    filtered.push(entry);
                    await Promise.all([
                        _storage_js_1.kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        _storage_js_1.kv.del(matchKey((0, _utils_js_1.safeName)(name))), // clear any stale prior match
                    ]);
                    return { status: 200, body: { inQueue: true, queueSize: filtered.length, match: null } };
                }
                if (action === 'poll') {
                    // #10: if a prior poll (mine OR the opponent's) already matched
                    // me, return that durable match instead of re-matching — so the
                    // side that didn't poll first still gets the match rather than a
                    // bare inQueue:false that looks like "you left".
                    const myMatch = await _storage_js_1.kv.get(matchKey((0, _utils_js_1.safeName)(name)));
                    if (myMatch) {
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: myMatch } };
                    }
                    const me = active.find(e => e.name === (0, _utils_js_1.safeName)(name));
                    if (!me)
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };
                    const others = active.filter(e => e.name !== me.name);
                    if (others.length === 0) {
                        const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                        await _storage_js_1.kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { status: 200, body: { inQueue: true, queueSize: active.length, match: null } };
                    }
                    // Level band, widens with the caller's wait time so an
                    // off-curve level eventually matches anyone. Falls back to
                    // pure-Elo selection when the band has nobody in it (queue
                    // never starves).
                    const waitMs = Math.max(0, Date.now() - me.joinedAt);
                    const band = LEVEL_BAND_BASE + Math.floor(waitMs / LEVEL_BAND_OPEN_INTERVAL_MS);
                    const inBand = others.filter(e => Math.abs(e.level - me.level) <= band);
                    const candidates = inBand.length > 0 ? inBand : others;
                    candidates.sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
                    const opponent = candidates[0];
                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                    // Deterministic initiator (lexicographically smaller slug) so
                    // exactly ONE side sends the ranked challenge and the other
                    // waits for it — no double-challenge, no silent drop. Both get a
                    // durable match record so neither vanishes if a poll is missed.
                    const initiatorName = me.name < opponent.name ? me.name : opponent.name;
                    const now = Date.now();
                    const matchForMe = { opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level, initiator: me.name === initiatorName, createdAt: now };
                    const matchForOpp = { opponent: me.name, opponentElo: me.elo, opponentLevel: me.level, initiator: opponent.name === initiatorName, createdAt: now };
                    await Promise.all([
                        _storage_js_1.kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        _storage_js_1.kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        _storage_js_1.kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                        // #10: server proof that THESE two players genuinely matched
                        // on the player ladder. pvp/session.ts consumes it (single-
                        // use) before honoring a `ranked` claim, so the ranked flag
                        // can no longer be self-asserted by the client.
                        (0, _ranked_match_token_js_1.mintRankedMatchToken)(me.name, opponent.name, 'player'),
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
                }
                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json(out.body);
        }
        catch (err) {
            console.error('[pvp/ranked-queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
