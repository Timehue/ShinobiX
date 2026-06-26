import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { computeLoginReward, daysUntilShardBonus, STREAK_SHARD_INTERVAL } from './_daily-login.js';

/*
 * /api/player/daily-login — POST only
 *
 * Server-authoritative daily login-streak reward. Grants level-scaled ryo once
 * per UTC day, plus 5 fate shards on every 7th consecutive day. Mirrors the
 * hardened claim-daily-agenda pattern: the read-modify-write runs INSIDE
 * withKvLock(save:<name>) with failClosed (currency path) so a concurrent
 * /api/save can't clobber the credit, and idempotency is the date stamp on the
 * save itself (char.lastLoginRewardDate) read inside the lock — claiming twice
 * in a day is a no-op that just echoes the current streak.
 *
 * The reward params are sealed server-side (api/player/_daily-login.ts) — the
 * client body carries no amounts. The client adds the returned `granted` delta
 * to its own balance (preserving concurrent ryo gains) and re-asserts via
 * autosave; the two converge.
 *
 * Body: { playerName }. Caller MUST be the player (or admin). Rate-limited
 * 30/min per actor.
 */

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function utcDateOffset(deltaDays: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
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
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'daily-login', 30, 60_000, identity.name))) return;

        const today = utcDateOffset(0);
        const yesterday = utcDateOffset(-1);

        let out: { error: 'no-save' } | { alreadyClaimed: boolean; streak: number; ryo: number; fateShards: number };
        try {
            out = await withKvLock(`save:${playerName}`, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { error: 'no-save' as const };

                const reward = computeLoginReward({
                    lastDate: String(char.lastLoginRewardDate ?? ''),
                    prevStreak: num(char.loginStreak),
                    level: num(char.level),
                    today,
                    yesterday,
                });
                if (reward.alreadyClaimed) return reward;

                const nextChar = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    fateShards: num(char.fateShards) + reward.fateShards,
                    loginStreak: reward.streak,
                    lastLoginRewardDate: today,
                };
                const nextRecord = bumpSaveVersion({ ...rec, character: nextChar });
                await kv.set(`save:${playerName}`, mergePreservingImages(nextRecord, rec));
                return reward;
            }, { failClosed: true });
        } catch (e) {
            console.error('[player/daily-login] credit failed', e);
            return res.status(503).json({ error: 'Could not grant your daily reward — please retry.' });
        }

        if ('error' in out) return res.status(404).json({ error: 'Your save was not found.' });

        return res.status(200).json({
            ok: true,
            alreadyClaimed: out.alreadyClaimed,
            streak: out.streak,
            granted: { ryo: out.ryo, fateShards: out.fateShards },
            shardInterval: STREAK_SHARD_INTERVAL,
            daysUntilShardBonus: daysUntilShardBonus(out.streak),
        });
    } catch (err) {
        console.error('[player/daily-login]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
