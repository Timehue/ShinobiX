import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';

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
    cors(res, req);
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
            const { name, action } = body as {
                name?: string;
                level?: number;
                elo?: number;
                action?: 'join' | 'leave' | 'poll';
            };
            if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

            // Require auth, body name must match identity.
            const identity = await authedPlayerOrAdmin(req, name);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }

            // Lock the queue around every mutating action — without it two
            // join/poll/leave POSTs racing on the same `pvp:ranked-queue` key
            // can read the same snapshot, both append/remove, and the second
            // write clobbers the first. Worst case before the lock: two
            // players who polled simultaneously both matched with the same
            // opponent, or a fresh join silently vanished. Reads inside
            // the lock so we always operate on the latest queue snapshot.
            const outcome = await withKvLock(QUEUE_KEY, async () => {
                const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
                const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);

                if (action === 'leave') {
                    const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                    await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                    return { inQueue: false, queueSize: filtered.length, match: null };
                }

                if (action === 'join') {
                    let serverLevel = 1;
                    let serverElo = 1000;
                    if (!identity.admin) {
                        try {
                            const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                            const char = (save?.character ?? null) as Record<string, unknown> | null;
                            if (char) {
                                if (typeof char.level === 'number') serverLevel = char.level;
                                if (typeof char.rankedRating === 'number') serverElo = char.rankedRating;
                                else if (typeof char.elo === 'number') serverElo = char.elo;
                            }
                        } catch { /* best-effort; defaults apply */ }
                    }

                    const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                    const entry: QueueEntry = {
                        name: name.toLowerCase().trim(),
                        level: serverLevel,
                        elo: serverElo,
                        joinedAt: Date.now(),
                    };
                    filtered.push(entry);
                    await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                    return { inQueue: true, queueSize: filtered.length, match: null };
                }

                if (action === 'poll') {
                    const me = active.find(e => e.name === name.toLowerCase().trim());
                    if (!me) return { inQueue: false, queueSize: active.length, match: null };

                    const others = active.filter(e => e.name !== me.name);
                    if (others.length === 0) {
                        const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                        await kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { inQueue: true, queueSize: active.length, match: null };
                    }

                    others.sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
                    const opponent = others[0];

                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                    await kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS });

                    return {
                        inQueue: false,
                        queueSize: remaining.length,
                        match: { opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level },
                    };
                }

                return null;
            });

            if (outcome === null) return res.status(400).json({ error: 'Invalid action.' });
            return res.status(200).json(outcome);
        } catch (err) {
            console.error('[pvp/ranked-queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
