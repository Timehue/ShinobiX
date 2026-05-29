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

// Separate queue blob from the player ranked ladder so pet ranked and player
// ranked matchmaking never cross-match. Elo is derived from petRankedRating.
const QUEUE_KEY = 'pvp:pet-ranked-queue';
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

            // Pre-derive server-side level/elo for the join path before
            // entering the lock so the lock body stays fast.
            let serverLevel = 1;
            let serverElo = 1000;
            if (action === 'join' && !identity.admin) {
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (char) {
                        if (typeof char.level === 'number') serverLevel = char.level;
                        if (typeof char.petRankedRating === 'number') serverElo = char.petRankedRating;
                    }
                } catch {
                    // best-effort; defaults apply
                }
            }

            // Serialize join/leave/poll against the shared QUEUE_KEY blob so
            // two concurrent writers can't get→filter→push→set and silently
            // drop one of the writes. Self-healing on next poll (the dropped
            // entry re-queues), so this is defense-in-depth.
            const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(QUEUE_KEY, async () => {
                const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
                const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);

                if (action === 'leave') {
                    const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                    await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                    return { status: 200, body: { inQueue: false, queueSize: filtered.length, match: null } };
                }

                if (action === 'join') {
                    // Remove existing entry for this player, then add fresh
                    const filtered = active.filter(e => e.name !== name.toLowerCase().trim());
                    const entry: QueueEntry = {
                        name: name.toLowerCase().trim(),
                        level: serverLevel,
                        elo: serverElo,
                        joinedAt: Date.now(),
                    };
                    filtered.push(entry);
                    await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                    return { status: 200, body: { inQueue: true, queueSize: filtered.length, match: null } };
                }

                if (action === 'poll') {
                    const me = active.find(e => e.name === name.toLowerCase().trim());
                    if (!me) return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };

                    const others = active.filter(e => e.name !== me.name);
                    if (others.length === 0) {
                        const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                        await kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { status: 200, body: { inQueue: true, queueSize: active.length, match: null } };
                    }

                    others.sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
                    const opponent = others[0];
                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                    await kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS });

                    return {
                        status: 200,
                        body: {
                            inQueue: false,
                            queueSize: remaining.length,
                            match: { opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level },
                        },
                    };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json(out.body);
        } catch (err) {
            console.error('[pvp/pet-ranked-queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
