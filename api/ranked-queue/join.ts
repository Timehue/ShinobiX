import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';

type QueueEntry = {
    name: string;
    rating: number;
    joinedAt: number;
};

const QUEUE_KEY = 'ranked-queue';
const NOTIFY_TTL = 120; // seconds
const STALE_MS = 5 * 60 * 1000; // 5 minutes

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, peek } = body as { name?: string; rating?: number; peek?: boolean };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        // Peek-only: just return current queue size without mutating anything.
        // Peek is open (no auth) to keep the lobby visible.
        if (peek || name.startsWith('__peek__')) {
            const rawPeek = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
            const nowPeek = Date.now();
            const activePeek = rawPeek.filter((e) => nowPeek - e.joinedAt < STALE_MS);
            return res.status(200).json({ queueSize: activePeek.length });
        }

        // Joining the queue mutates state — require auth, body name must match identity.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
            return res.status(403).json({ error: 'Cannot queue as another player.' });
        }

        const nameLower = name.toLowerCase().trim();

        // Derive rating from the server-side save — never trust the body.
        let playerRating = 1000;
        if (!identity.admin) {
            try {
                const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                const char = (save?.character ?? null) as Record<string, unknown> | null;
                if (char) {
                    if (typeof char.rankedRating === 'number') playerRating = char.rankedRating;
                    else if (typeof char.elo === 'number') playerRating = char.elo;
                }
            } catch {
                // best-effort; default applies
            }
        }

        // Check if this player already has a match notification waiting
        const notifyKey = `ranked-queue-notify:${nameLower}`;
        const notification = await kv.get<{ opponentName: string }>(notifyKey);
        if (notification) {
            await kv.del(notifyKey);
            return res.status(200).json({ matched: true, opponentName: notification.opponentName });
        }

        // Lock the queue around the read-match-write so two simultaneous
        // joiners can't both pull the same opponent off the queue (which
        // previously could double-match an opponent or lose a join entry).
        const result = await withKvLock(QUEUE_KEY, async () => {
            const raw = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
            const now = Date.now();
            let queue = raw.filter((e) => now - e.joinedAt < STALE_MS && e.name.toLowerCase() !== nameLower);

            if (queue.length > 0) {
                queue.sort((a, b) => Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating));
                const opponent = queue[0];
                queue = queue.filter((e) => e.name.toLowerCase() !== opponent.name.toLowerCase());
                await kv.set(QUEUE_KEY, queue, { ex: 600 });

                const challenge = {
                    id: `rq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    fromName: opponent.name,
                    toName: name,
                    challenger: { name: opponent.name, rankedRating: opponent.rating },
                    createdAt: now,
                    mode: 'ranked' as const,
                    queueMatch: true,
                };

                // Append the challenge to the joiner's inbox under its own
                // lock so a separate /api/player/challenge POST landing in
                // the same tick doesn't lose either write.
                const joinerKey = `challenges:${nameLower}`;
                await withKvLock(joinerKey, async () => {
                    const existing = await kv.get<unknown[]>(joinerKey) ?? [];
                    await kv.set(joinerKey, [...existing, challenge].slice(-20), { ex: NOTIFY_TTL });
                });

                await kv.set(`ranked-queue-notify:${opponent.name.toLowerCase().trim()}`, { opponentName: name }, { ex: NOTIFY_TTL });

                return { matched: true as const, opponentName: opponent.name, challenge };
            }

            queue.push({ name, rating: playerRating, joinedAt: now });
            await kv.set(QUEUE_KEY, queue, { ex: 600 });
            return { matched: false as const, queueSize: queue.length };
        });

        if (result.matched) {
            return res.status(200).json({ matched: true, opponentName: result.opponentName, challenge: result.challenge });
        }
        return res.status(200).json({ queued: true, queueSize: result.queueSize });
    } catch (err) {
        console.error('[ranked-queue/join]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
