import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { randomUUID } from 'node:crypto';

/*
 * /api/card-clash/queue — open matchmaking for FREE-PLAY Shinobi Card Clash PvP.
 *
 * Forked from api/pvp/pet-ranked-queue.ts: join/leave/poll against a shared queue
 * blob under withKvLock. Whoever polls first and finds an opponent mints a shared
 * match id, pairs the two, writes a durable per-player match record (so the side
 * that didn't poll first still gets the match) AND a shared "pair" auth record the
 * /api/card-clash/match handler reads to authorise the two joiners. Both players
 * then join /api/card-clash/match with the minted matchId.
 *
 * Card Clash has no rating, so pairing is by LEVEL proximity (band widens with
 * wait time, falls back to anyone). Free-play is UNRANKED with NO currency reward
 * — the match handler pays nothing, so there is no win-trading incentive here.
 *
 * Body: { name, action: 'join' | 'leave' | 'poll' }
 */

type QueueEntry = { name: string; level: number; joinedAt: number };

const QUEUE_KEY = 'card-clash:queue';
const KV_TTL_SECONDS = 2 * 60 * 60;
const STALE_MS = 60 * 1000;             // entries older than this must re-queue
const MATCH_TTL_SECONDS = 45;           // per-player pairing record (poll handoff)
const PAIR_TTL_SECONDS = 5 * 60;        // shared match-auth record (join window)
const matchKey = (slug: string) => `${QUEUE_KEY}:match:${slug}`;
const pairKey = (matchId: string) => `cc-pair:${matchId}`;
// Level band — mirrors pet-ranked-queue.ts; widens with the caller's wait so a
// sparse queue eventually pairs anyone, but the first pass prefers same-level.
const LEVEL_BAND_BASE = 10;
const LEVEL_BAND_OPEN_INTERVAL_MS = 15_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const name = typeof req.query.name === 'string' ? safeName(req.query.name) : '';
        const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
        const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ inQueue: active.some(e => e.name === name), queueSize: active.length });
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, action } = body as { name?: string; action?: 'join' | 'leave' | 'poll' };
            if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

            const identity = await authedPlayerOrAdmin(req, name);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== safeName(name)) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }
            // ~60/min covers a ~2-3s poll cadence; without it spam serializes on the
            // shared QUEUE_KEY lock and degrades matchmaking latency for everyone.
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-clash-queue', 60, 60_000, identity.name))) return;

            // Pre-derive level from the save before the lock so the lock body stays fast.
            let serverLevel = 1;
            if (action === 'join' && !identity.admin) {
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (char && typeof char.level === 'number') serverLevel = char.level;
                } catch { /* best-effort; default applies */ }
            }

            const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(QUEUE_KEY, async () => {
                const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
                const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
                const slug = safeName(name);

                if (action === 'leave') {
                    const filtered = active.filter(e => e.name !== slug);
                    await Promise.all([
                        kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        kv.del(matchKey(slug)),
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: filtered.length, match: null } };
                }

                if (action === 'join') {
                    const filtered = active.filter(e => e.name !== slug);
                    filtered.push({ name: slug, level: serverLevel, joinedAt: Date.now() });
                    await Promise.all([
                        kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        kv.del(matchKey(slug)),   // clear any stale prior pairing
                    ]);
                    return { status: 200, body: { inQueue: true, queueSize: filtered.length, match: null } };
                }

                if (action === 'poll') {
                    // If a prior poll (mine OR the opponent's) already paired me, return
                    // that durable match so the side that didn't pair first still gets it.
                    const myMatch = await kv.get<Record<string, unknown>>(matchKey(slug));
                    if (myMatch) return { status: 200, body: { inQueue: false, queueSize: active.length, match: myMatch } };

                    const me = active.find(e => e.name === slug);
                    if (!me) return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };

                    const others = active.filter(e => e.name !== me.name);
                    if (others.length === 0) {
                        const refreshed = active.map(e => e.name === me.name ? { ...e, joinedAt: Date.now() } : e);
                        await kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { status: 200, body: { inQueue: true, queueSize: active.length, match: null } };
                    }

                    const waitMs = Math.max(0, Date.now() - me.joinedAt);
                    const band = LEVEL_BAND_BASE + Math.floor(waitMs / LEVEL_BAND_OPEN_INTERVAL_MS);
                    const inBand = others.filter(e => Math.abs(e.level - me.level) <= band);
                    const candidates = inBand.length > 0 ? inBand : others;
                    candidates.sort((a, b) => Math.abs(a.level - me.level) - Math.abs(b.level - me.level));
                    const opponent = candidates[0];
                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);

                    // Deterministic slot assignment: the lexicographically smaller slug
                    // is p1 (opens the match session), the other is p2 (joins).
                    const matchId = randomUUID();
                    const p1Name = me.name < opponent.name ? me.name : opponent.name;
                    const p2Name = me.name < opponent.name ? opponent.name : me.name;
                    const now = Date.now();
                    const matchForMe = { matchId, opponent: opponent.name, p1: me.name === p1Name, createdAt: now };
                    const matchForOpp = { matchId, opponent: me.name, p1: opponent.name === p1Name, createdAt: now };
                    await Promise.all([
                        kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                        // Shared auth record the match handler reads to gate joins.
                        kv.set(pairKey(matchId), { matchId, p1Name, p2Name, createdAt: now }, { ex: PAIR_TTL_SECONDS }),
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json(out.body);
        } catch (err) {
            console.error('[card-clash/queue]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
