import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';

/*
 * /api/missions/raid-start  — POST only
 *
 * Mints a single-use raid token tied to an in-flight AI raid. PvP-flavored
 * raids already cross-validate against the PvpSession KV record (see
 * report-raid.ts), but AI raids have no server-side session — the entire
 * single-player battle is client-driven. Without this endpoint, a malicious
 * Vanguard could spam /api/missions/report-raid up to the 60/day cap with
 * zero actual gameplay.
 *
 * The token is a UUID stored under `raid-token:<player>:<uuid>` with a 5-min
 * TTL. The client retains it until the battle resolves, then passes it to
 * report-raid which validates + atomically deletes the key.
 *
 * Body shape:
 *   { playerName, aiId?: string, sector?: number }
 *
 * aiId and sector are optional metadata that future audit/replay tooling
 * can use; they're stored on the token and the report-raid endpoint can
 * cross-check them when present.
 *
 * Rate limited 1 per 30s + 30 per day (half the report-raid cap, since the
 * report itself also rate-limits — the effective ceiling stays at 30/day for
 * AI raids).
 */

const MAX_RAID_STARTS_PER_DAY = 30;
const RAID_TOKEN_TTL_SECONDS = 5 * 60;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Pre-auth rate limit so unauthenticated spam at unknown names still
    // throttles.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'raid-start', 1, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const aiIdRaw = typeof body.aiId === 'string' ? body.aiId.trim().slice(0, 64) : '';
        const aiId = /^[A-Za-z0-9:_-]+$/.test(aiIdRaw) ? aiIdRaw : '';
        const sectorRaw = Number(body.sector);
        const sector = Number.isFinite(sectorRaw) ? Math.max(0, Math.min(999, Math.floor(sectorRaw))) : 0;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own raids.' });
        }

        // Player must be a Vanguard to mint a raid token — non-vanguards
        // can do raids but get no vanguard mission progress, so token
        // minting is pointless. Skipping here is cheaper than letting
        // report-raid noop later.
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (char?.profession !== 'vanguard') {
            // Return 200 (not an error — non-vanguards calling this is a
            // client-side mistake, not a security event).
            return res.status(200).json({ ok: true, vanguard: false });
        }

        // Daily mint cap. Separate counter from the report-raid daily cap
        // because the two endpoints can fire independently (a mint without
        // a corresponding report still counts toward the mint cap).
        const today = utcDateKey();
        const dailyKey = `raid-start-count:${playerName}:${today}`;
        // Atomic increment (kv_incr) so two concurrent mints can't both read the
        // same count and both slip under the cap — the old get-then-set was a
        // raceable read-modify-write. incr returns the post-increment count, so
        // the (cap+1)-th call is the first to exceed it.
        const startedToday = await kv.incr(dailyKey, { ex: 25 * 60 * 60 });
        if (startedToday > MAX_RAID_STARTS_PER_DAY) {
            return res.status(200).json({
                ok: true,
                vanguard: true,
                reason: 'daily-mint-cap',
                token: null,
            });
        }

        // Mint a UUID-keyed token. Single-use (deleted on consume in
        // report-raid). 5-min TTL covers the longest realistic AI raid.
        const tokenId = randomUUID().replace(/-/g, '');
        const tokenKey = `raid-token:${playerName}:${tokenId}`;
        await kv.set(tokenKey, {
            playerName,
            mintedAt: Date.now(),
            aiId: aiId || undefined,
            sector: sector || undefined,
        }, { ex: RAID_TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, vanguard: true, token: tokenId });
    } catch (err) {
        console.error('[missions/raid-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
