import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { mintRankedMatchToken } from '../_ranked-match-token.js';

type QueueEntry = {
    name: string;
    level: number;
    elo: number;
    joinedAt: number;
};

const QUEUE_KEY = 'pvp:ranked-queue';
const KV_TTL_SECONDS = 2 * 60 * 60;   // 2-hour TTL
const STALE_MS = 60 * 1000;           // Remove entries older than 60s (must re-queue)
// Durable per-player match record (audit #10). When two players are matched,
// BOTH get one — so the player who didn't poll first still discovers the match
// on their next poll instead of silently vanishing from the queue. Short TTL so
// a match that never turns into a fight re-opens matchmaking for both sides.
const MATCH_TTL_SECONDS = 30;
const matchKey = (slug: string) => `${QUEUE_KEY}:match:${slug}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        // Return queue status for a specific player (don't expose other names)
        const name = typeof req.query.name === 'string' ? safeName(req.query.name) : '';
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
            if (!identity.admin && identity.name !== safeName(name)) {
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
                        if (typeof char.rankedRating === 'number') serverElo = char.rankedRating;
                        else if (typeof char.elo === 'number') serverElo = char.elo;
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
                    const filtered = active.filter(e => e.name !== safeName(name));
                    await Promise.all([
                        kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        kv.del(matchKey(safeName(name))),  // drop any pending match too
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: filtered.length, match: null } };
                }

                if (action === 'join') {
                    // Remove existing entry for this player, then add fresh
                    const filtered = active.filter(e => e.name !== safeName(name));
                    const entry: QueueEntry = {
                        name: safeName(name),
                        level: serverLevel,
                        elo: serverElo,
                        joinedAt: Date.now(),
                    };
                    filtered.push(entry);
                    await Promise.all([
                        kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        kv.del(matchKey(safeName(name))),  // clear any stale prior match
                    ]);
                    return { status: 200, body: { inQueue: true, queueSize: filtered.length, match: null } };
                }

                if (action === 'poll') {
                    // #10: if a prior poll (mine OR the opponent's) already matched
                    // me, return that durable match instead of re-matching — so the
                    // side that didn't poll first still gets the match rather than a
                    // bare inQueue:false that looks like "you left".
                    const myMatch = await kv.get<Record<string, unknown>>(matchKey(safeName(name)));
                    if (myMatch) {
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: myMatch } };
                    }

                    const me = active.find(e => e.name === safeName(name));
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
                    // Deterministic initiator (lexicographically smaller slug) so
                    // exactly ONE side sends the ranked challenge and the other
                    // waits for it — no double-challenge, no silent drop. Both get a
                    // durable match record so neither vanishes if a poll is missed.
                    const initiatorName = me.name < opponent.name ? me.name : opponent.name;
                    const now = Date.now();
                    const matchForMe = { opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level, initiator: me.name === initiatorName, createdAt: now };
                    const matchForOpp = { opponent: me.name, opponentElo: me.elo, opponentLevel: me.level, initiator: opponent.name === initiatorName, createdAt: now };
                    await Promise.all([
                        kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                        // #10: server proof that THESE two players genuinely matched
                        // on the player ladder. pvp/session.ts consumes it (single-
                        // use) before honoring a `ranked` claim, so the ranked flag
                        // can no longer be self-asserted by the client.
                        mintRankedMatchToken(me.name, opponent.name, 'player'),
                    ]);

                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json(out.body);
        } catch (err) {
            console.error('[pvp/ranked-queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
