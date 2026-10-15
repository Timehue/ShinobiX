import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { buildPublicLeaderboards, isPublicPlayerIndexKey } from './_public-index.js';
import { readPublicPlayerIndex } from './_public-index-store.js';
import { cachedFor } from '../_proc-cache.js';
import { enforceRateLimit, PUBLIC_READ_IP_BACKSTOP, requestPlayerKey } from '../_ratelimit.js';

// Unauthenticated GET that reads the whole public player index. A short
// in-process cache collapses a burst of requests (or a scripted flood) into one
// index read per TTL per `limit`. Kept to a few seconds because ranked
// settlement projects a new rating immediately and a player returning from a
// fight expects to see it; the response itself stays `no-store`.
const LEADERBOARDS_CACHE_TTL_MS = 3_000;
// Per name@IP budget (with the tight public-read IP backstop). In-memory, not
// KV: a KV-backed limiter would itself cost a write on every request.
const LEADERBOARDS_RATE_LIMIT = 30;
const LEADERBOARDS_RATE_WINDOW_MS = 60_000;

function parseLimit(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 25;
    return Math.max(1, Math.min(Math.floor(n), 100));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!enforceRateLimit(
        req, res, 'player-leaderboards', LEADERBOARDS_RATE_LIMIT, LEADERBOARDS_RATE_WINDOW_MS,
        requestPlayerKey(req), { ipBackstopMultiplier: PUBLIC_READ_IP_BACKSTOP },
    )) return;

    try {
        const limit = parseLimit(req.query.limit);
        const payload = await cachedFor(`player:leaderboards:${limit}`, LEADERBOARDS_CACHE_TTL_MS, async () => {
            const onlineNames = new Set(onlineStore.list().map((entry) => entry.name));
            const { entries, backfilled, staleKeys } = await readPublicPlayerIndex({ backfill: true, logContext: 'leaderboards' });
            const publicEntries = [...entries.entries()]
                .filter(([key, entry]) => isPublicPlayerIndexKey(key) && isPublicPlayerIndexKey(entry.name))
                .map(([, entry]) => entry);
            const boards = buildPublicLeaderboards(publicEntries, onlineNames, limit);
            return {
                ok: true,
                generatedAt: Date.now(),
                limit,
                backfilled,
                stale: staleKeys.length,
                boards,
            };
        });

        // Ranked settlement projects the new rating before its journal closes.
        // An edge/browser-cached board would still show the previous result
        // immediately after a player returns from that battle; the process
        // cache above is bounded to a few seconds for the same reason.
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(payload);
    } catch (err) {
        console.error('[player-leaderboards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
