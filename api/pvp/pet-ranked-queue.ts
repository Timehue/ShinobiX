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

// Separate queue blob from the player ranked ladder so pet ranked and player
// ranked matchmaking never cross-match. Elo is derived from petRankedRating.
const QUEUE_KEY = 'pvp:pet-ranked-queue';
const KV_TTL_SECONDS = 2 * 60 * 60;   // 2-hour TTL
const STALE_MS = 60 * 1000;           // Remove entries older than 60s (must re-queue)
// Durable per-player match record (audit #10) — see ranked-queue.ts for the
// rationale. BOTH matched players get one so neither silently vanishes from the
// queue when only one polled; short TTL re-opens matchmaking if no fight starts.
const MATCH_TTL_SECONDS = 30;
const matchKey = (slug: string) => `${QUEUE_KEY}:match:${slug}`;
// Matchmaking level band — mirrors ranked-queue.ts. Widens linearly with the
// caller's wait so a sparse pet-ladder level eventually matches anyone, but
// the initial pairing prefers same-level opponents.
const LEVEL_BAND_BASE = 10;
const LEVEL_BAND_OPEN_INTERVAL_MS = 15_000;

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

                    // Level band — mirrors ranked-queue.ts. Widens with the
                    // caller's wait time, falls back to pure-Elo if nothing fits.
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
                        kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                        // #10: server proof that THESE two players genuinely matched
                        // on the PET ladder, mirroring the player queue. Consumed by
                        // pvp/session.ts before honoring a `ranked`+rankedKind:'pet'
                        // claim. (Today the live pet ladder settles via the pet
                        // battle flow, not session.ts, so this token simply expires
                        // unused there — it keeps session.ts's pet branch honest if a
                        // client ever routes a pet-ranked session through it.)
                        mintRankedMatchToken(me.name, opponent.name, 'pet'),
                    ]);

                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
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
