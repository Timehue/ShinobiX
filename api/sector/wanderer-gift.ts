import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { decideWandererGift, WANDERER_GIFTS_PER_DAY } from './_wanderer-gift.js';

/*
 * /api/sector/wanderer-gift — POST only
 *
 * A friendly sector Wanderer hands the player a small gift. Server-authoritative:
 * the reward is RECOMPUTED here (never read from the client) and bounded by a
 * per-day cap, so it can't be farmed into a ryo faucet. Mirrors the
 * recompute-server-side pattern in docs/auth-and-anti-cheat-patterns.md.
 *
 * Body: { playerName, sector? }
 * → { ok:true, ryo, totalRyo, claimsLeft } | { ok:false, reason }
 */

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'wanderer-gift', 12, 60_000, identity.name))) return;

        // Atomic daily counter. incr returns the post-increment count, so
        // claimsSoFar (count BEFORE this gift) = countAfter - 1.
        const dayKey = `wanderer-gift:${playerName}:${utcDateKey()}`;
        const countAfter = await kv.incr(dayKey, { ex: 25 * 60 * 60 });
        const claimsSoFar = Math.max(0, countAfter - 1);

        const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

            const decision = decideWandererGift(Number(char.level ?? 1), claimsSoFar);
            if (!decision.ok) {
                return { status: 200, body: { ok: false, reason: decision.reason, claimsLeft: 0 } };
            }
            const totalRyo = Number(char.ryo ?? 0) + decision.ryo;
            await kv.set(`save:${playerName}`, mergePreservingImages({ ...rec, character: { ...char, ryo: totalRyo } }, rec));
            return {
                status: 200,
                body: { ok: true, ryo: decision.ryo, totalRyo, claimsLeft: Math.max(0, WANDERER_GIFTS_PER_DAY - countAfter) },
            };
        }, { failClosed: true });

        return res.status(out.status).json(out.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not grant the gift — please retry.' });
        }
        console.error('[sector/wanderer-gift]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
