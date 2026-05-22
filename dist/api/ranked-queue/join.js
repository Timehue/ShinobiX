"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const QUEUE_KEY = 'ranked-queue';
const NOTIFY_TTL = 120; // seconds
const STALE_MS = 5 * 60 * 1000; // 5 minutes
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, rating, peek } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        // Peek-only: just return current queue size without mutating anything
        if (peek || name.startsWith('__peek__')) {
            const rawPeek = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
            const nowPeek = Date.now();
            const activePeek = rawPeek.filter((e) => nowPeek - e.joinedAt < STALE_MS);
            return res.status(200).json({ queueSize: activePeek.length });
        }
        const playerRating = rating ?? 1000;
        const nameLower = name.toLowerCase().trim();
        // Check if this player already has a match notification waiting
        const notifyKey = `ranked-queue-notify:${nameLower}`;
        const notification = await _storage_js_1.kv.get(notifyKey);
        if (notification) {
            await _storage_js_1.kv.del(notifyKey);
            return res.status(200).json({ matched: true, opponentName: notification.opponentName });
        }
        // Load and clean the queue
        const raw = await _storage_js_1.kv.get(QUEUE_KEY) ?? [];
        const now = Date.now();
        let queue = raw.filter((e) => now - e.joinedAt < STALE_MS && e.name.toLowerCase() !== nameLower);
        // Try to find a match — prefer closest Elo, but accept anyone
        if (queue.length > 0) {
            queue.sort((a, b) => Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating));
            const opponent = queue[0];
            queue = queue.filter((e) => e.name.toLowerCase() !== opponent.name.toLowerCase());
            // Persist updated queue (opponent removed)
            await _storage_js_1.kv.set(QUEUE_KEY, queue, { ex: 600 });
            // Build a ranked challenge: opponent (waiting) = fromName/challenger, joiner = toName/defender
            const challenge = {
                id: `rq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                fromName: opponent.name,
                toName: name,
                challenger: { name: opponent.name, rankedRating: opponent.rating },
                createdAt: now,
                mode: 'ranked',
                queueMatch: true,
            };
            // Write challenge to joiner's (defender's) challenges list
            const joinerKey = `challenges:${nameLower}`;
            const existing = await _storage_js_1.kv.get(joinerKey) ?? [];
            await _storage_js_1.kv.set(joinerKey, [...existing, challenge].slice(-20), { ex: NOTIFY_TTL });
            // Notify the waiting player (challenger) so their poll returns matched
            await _storage_js_1.kv.set(`ranked-queue-notify:${opponent.name.toLowerCase().trim()}`, { opponentName: name }, { ex: NOTIFY_TTL });
            return res.status(200).json({ matched: true, opponentName: opponent.name, challenge });
        }
        // No match — add this player to the queue
        queue.push({ name, rating: playerRating, joinedAt: now });
        await _storage_js_1.kv.set(QUEUE_KEY, queue, { ex: 600 });
        return res.status(200).json({ queued: true, queueSize: queue.length });
    }
    catch (err) {
        console.error('[ranked-queue/join]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
