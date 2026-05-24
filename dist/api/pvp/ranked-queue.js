"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const QUEUE_KEY = 'pvp:ranked-queue';
const KV_TTL_SECONDS = 2 * 60 * 60; // 2-hour TTL
const STALE_MS = 60 * 1000; // Remove entries older than 60s (must re-queue)
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        // Return queue status for a specific player (don't expose other names)
        const name = typeof req.query.name === 'string' ? req.query.name.trim().toLowerCase() : '';
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
            if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }
            const queue = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
            // Remove stale entries
            const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
            if (action === 'leave') {
                const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                await _storage_js_1.kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                return res.status(200).json({ inQueue: false, queueSize: filtered.length, match: null });
            }
            if (action === 'join') {
                // Derive level + elo from the server-side save — never trust the body.
                let serverLevel = 1;
                let serverElo = 1000;
                if (!identity.admin) {
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
                }
                // Remove existing entry for this player, then add fresh
                const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                const entry = {
                    name: name.toLowerCase().trim(),
                    level: serverLevel,
                    elo: serverElo,
                    joinedAt: Date.now(),
                };
                filtered.push(entry);
                await _storage_js_1.kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                return res.status(200).json({ inQueue: true, queueSize: filtered.length, match: null });
            }
            if (action === 'poll') {
                // Check if there's a match for this player
                const me = active.find(e => e.name === name.toLowerCase().trim());
                if (!me)
                    return res.status(200).json({ inQueue: false, queueSize: active.length, match: null });
                // Find opponent: someone else in the queue (closest Elo, then longest waiting)
                const others = active.filter(e => e.name !== me.name);
                if (others.length === 0) {
                    // Re-stamp my joinedAt to keep entry fresh
                    const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                    await _storage_js_1.kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                    return res.status(200).json({ inQueue: true, queueSize: active.length, match: null });
                }
                // Match with closest Elo
                others.sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
                const opponent = others[0];
                // Remove both from queue
                const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                await _storage_js_1.kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS });
                return res.status(200).json({
                    inQueue: false,
                    queueSize: remaining.length,
                    match: { opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level },
                });
            }
            return res.status(400).json({ error: 'Invalid action.' });
        }
        catch (err) {
            console.error('[pvp/ranked-queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
