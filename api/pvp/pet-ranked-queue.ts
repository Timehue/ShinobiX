import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    petRankedActiveKey,
    petRankedQueueMatchKey,
    PET_RANKED_QUEUE_KEY,
    PET_RANKED_QUEUE_MATCH_TTL_SECONDS,
} from '../pet/_ranked-engine.js';
import {
    PET_RANKED_PUBLIC_PRESENTATION_DISABLED_REASON,
    petRankedPublicPresentationEnabled,
} from '../pet/_ranked-settlement.js';
// NOTE: pet ranked is NOT gated by the player-side ranked-match-token system.
// The pet ladder settles via api/pet/battle-result.ts. This queue mints the
// reciprocal match id; /api/pet/ranked-start atomically turns that id into the
// private pet:ranked-token:<id> server-engine receipt. Do not use the player-PvP
// ranked-match-token dialect here.

type QueueEntry = {
    name: string;
    level: number;
    elo: number;
    joinedAt: number;
};

// Separate queue blob from the player ranked ladder so pet ranked and player
// ranked matchmaking never cross-match. Elo is derived from petRankedRating.
const QUEUE_KEY = PET_RANKED_QUEUE_KEY;
const KV_TTL_SECONDS = 2 * 60 * 60;   // 2-hour TTL
const STALE_MS = 60 * 1000;           // Remove entries older than 60s (must re-queue)
// Durable per-player match record (audit #10) — see ranked-queue.ts for the
// rationale. BOTH matched players get one so neither silently vanishes from the
// queue when only one polled; short TTL re-opens matchmaking if no fight starts.
const MATCH_TTL_SECONDS = PET_RANKED_QUEUE_MATCH_TTL_SECONDS;
const matchKey = petRankedQueueMatchKey;
// Matchmaking level band — mirrors ranked-queue.ts. Widens linearly with the
// caller's wait so a sparse pet-ladder level eventually matches anyone, but
// the initial pairing prefers same-level opponents.
const LEVEL_BAND_BASE = 10;
const LEVEL_BAND_OPEN_INTERVAL_MS = 15_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        if (!petRankedPublicPresentationEnabled()) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ enabled: false, inQueue: false, queueSize: 0, match: null });
        }
        // Return queue status for a specific player (don't expose other names)
        const name = typeof req.query.name === 'string' ? safeName(req.query.name) : '';
        const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
        const active = queue.filter(e => Date.now() - e.joinedAt < STALE_MS);
        const inQueue = active.some(e => e.name === name);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ enabled: true, inQueue, queueSize: active.length });
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
            if (action !== 'leave' && !petRankedPublicPresentationEnabled()) {
                return res.status(503).json({ error: PET_RANKED_PUBLIC_PRESENTATION_DISABLED_REASON });
            }

            // Require auth, body name must match identity.
            const identity = await authedPlayerOrAdmin(req, name);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== safeName(name)) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }

            // Throttle join/leave/poll per identity (keyed on name, not raw IP, so
            // two players behind one NAT aren't starved). Mirrors ranked-queue.ts —
            // without this, spam serializes on the shared QUEUE_KEY lock and degrades
            // matchmaking latency for everyone. ~60/min covers the ~2-3s poll cadence.
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-ranked-queue', 60, 60_000, identity.name))) return;

            const queueName = identity.admin ? safeName(name) : identity.name;
            if (action !== 'leave' && await kv.get<string>(petRankedActiveKey(queueName))) {
                return res.status(409).json({ error: 'Finish or acknowledge your active pet battle before queueing again.' });
            }

            // Pre-derive server-side level/elo for the join path before
            // entering the lock so the lock body stays fast. Ranked
            // matchmaking fails closed when the authoritative profile cannot
            // be read; request-body level/elo are never fallback authority.
            let serverLevel = 1;
            let serverElo = 1000;
            if (action === 'join') {
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${queueName}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (!char) return res.status(404).json({ error: 'Character not found.' });
                    const level = typeof char.level === 'number' && Number.isFinite(char.level) ? char.level : 1;
                    const elo = typeof char.petRankedRating === 'number' && Number.isFinite(char.petRankedRating)
                        ? char.petRankedRating
                        : 1000;
                    serverLevel = Math.max(1, Math.min(100, Math.floor(level)));
                    serverElo = Math.max(0, Math.floor(elo));
                } catch {
                    return res.status(503).json({ error: 'Ranked profile is temporarily unavailable.' });
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
                    if (await kv.get<string>(petRankedActiveKey(safeName(name)))) {
                        return { status: 409, body: { error: 'Finish or acknowledge your active pet battle before queueing again.' } };
                    }
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
                    if (await kv.get<string>(petRankedActiveKey(safeName(name)))) {
                        const filtered = active.filter(e => e.name !== safeName(name));
                        await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                        return { status: 409, body: { error: 'Finish or acknowledge your active pet battle before queueing again.' } };
                    }
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

                    const others: QueueEntry[] = [];
                    for (const candidate of active.filter(e => e.name !== me.name)) {
                        if (!await kv.get<string>(petRankedActiveKey(candidate.name))) others.push(candidate);
                    }
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
                    // exactly one side starts the private ranked receipt/presentation
                    // handshake. Both get a durable match record so neither vanishes
                    // if a poll is missed.
                    const initiatorName = me.name < opponent.name ? me.name : opponent.name;
                    const now = Date.now();
                    const matchId = randomUUID().replace(/-/g, '');
                    const matchForMe = { matchId, opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level, initiator: me.name === initiatorName, createdAt: now };
                    const matchForOpp = { matchId, opponent: me.name, opponentElo: me.elo, opponentLevel: me.level, initiator: opponent.name === initiatorName, createdAt: now };
                    // NOTE: no mintRankedMatchToken(..., 'pet') call here. The
                    // pet ladder is gated by /api/pet/ranked-start (own keyspace:
                    // pet:ranked-token:<id>) and settled by /api/pet/battle-result,
                    // not by pvp/session.ts. A pet-side `ranked` claim through
                    // session.ts would fail the player-token consume and degrade
                    // to casual, which is the correct conservative outcome.
                    await Promise.all([
                        kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                    ]);

                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json(out.body);
        } catch (err) {
            console.error('[pvp/pet-ranked-queue]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
