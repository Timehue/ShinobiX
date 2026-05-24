import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

type QueueEntry = {
    name: string;
    level: number;
    elo: number;
    joinedAt: number;
};

const QUEUE_KEY = 'pvp:ranked-queue';
const KV_TTL_SECONDS = 2 * 60 * 60;   // 2-hour TTL
const STALE_MS = 60 * 1000;           // Remove entries older than 60s (must re-queue)

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        // Return queue status for a specific player (don't expose other names)
        const name = typeof req.query.name === 'string' ? req.query.name.trim().toLowerCase() : '';
        const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
        const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
        const inQueue = active.some(e => e.name === name);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ inQueue, queueSize: active.length });
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, level, elo, action } = body as {
                name?: string;
                level?: number;
                elo?: number;
                action?: 'join' | 'leave' | 'poll';
            };
            if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

            const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
            // Remove stale entries
            const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);

            if (action === 'leave') {
                const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                return res.status(200).json({ inQueue: false, queueSize: filtered.length, match: null });
            }

            if (action === 'join') {
                // Remove existing entry for this player, then add fresh
                const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                const entry: QueueEntry = {
                    name: name.toLowerCase().trim(),
                    level: level ?? 1,
                    elo: elo ?? 1000,
                    joinedAt: Date.now(),
                };
                filtered.push(entry);
                await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                return res.status(200).json({ inQueue: true, queueSize: filtered.length, match: null });
            }

            if (action === 'poll') {
                // Check if there's a match for this player
                const me = active.find(e => e.name === name.toLowerCase().trim());
                if (!me) return res.status(200).json({ inQueue: false, queueSize: active.length, match: null });

                // Find opponent: someone else in the queue (closest Elo, then longest waiting)
                const others = active.filter(e => e.name !== me.name);
                if (others.length === 0) {
                    // Re-stamp my joinedAt to keep entry fresh
                    const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                    await kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                    return res.status(200).json({ inQueue: true, queueSize: active.length, match: null });
                }

                // Match with closest Elo
                others.sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
                const opponent = others[0];

                // Remove both from queue
                const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                await kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS });

                return res.status(200).json({
                    inQueue: false,
                    queueSize: remaining.length,
                    match: { opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level },
                });
            }

            return res.status(400).json({ error: 'Invalid action.' });
        } catch (err) {
            console.error('[pvp/ranked-queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
