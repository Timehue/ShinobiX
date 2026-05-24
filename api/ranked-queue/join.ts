import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

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

        // Load and clean the queue
        const raw = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
        const now = Date.now();
        let queue = raw.filter((e) => now - e.joinedAt < STALE_MS && e.name.toLowerCase() !== nameLower);

        // Try to find a match — prefer closest Elo, but accept anyone
        if (queue.length > 0) {
            queue.sort((a, b) => Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating));
            const opponent = queue[0];
            queue = queue.filter((e) => e.name.toLowerCase() !== opponent.name.toLowerCase());

            // Persist updated queue (opponent removed)
            await kv.set(QUEUE_KEY, queue, { ex: 600 });

            // Build a ranked challenge: opponent (waiting) = fromName/challenger, joiner = toName/defender
            const challenge = {
                id: `rq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                fromName: opponent.name,
                toName: name,
                challenger: { name: opponent.name, rankedRating: opponent.rating },
                createdAt: now,
                mode: 'ranked' as const,
                queueMatch: true,
            };

            // Write challenge to joiner's (defender's) challenges list
            const joinerKey = `challenges:${nameLower}`;
            const existing = await kv.get<unknown[]>(joinerKey) ?? [];
            await kv.set(joinerKey, [...existing, challenge].slice(-20), { ex: NOTIFY_TTL });

            // Notify the waiting player (challenger) so their poll returns matched
            await kv.set(`ranked-queue-notify:${opponent.name.toLowerCase().trim()}`, { opponentName: name }, { ex: NOTIFY_TTL });

            return res.status(200).json({ matched: true, opponentName: opponent.name, challenge });
        }

        // No match — add this player to the queue
        queue.push({ name, rating: playerRating, joinedAt: now });
        await kv.set(QUEUE_KEY, queue, { ex: 600 });

        return res.status(200).json({ queued: true, queueSize: queue.length });
    } catch (err) {
        console.error('[ranked-queue/join]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
