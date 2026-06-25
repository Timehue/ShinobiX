import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { rollAmbushReward, ambushCleared, AMBUSH_REWARDS_PER_DAY } from './_wanderer-ambush.js';

/*
 * /api/sector/wanderer-ambush — POST { action: 'start' | 'claim', playerName }
 *
 * Boss reward for clearing a sector-wanderer ambush. Server-authoritative:
 *   start → seal baseline foe-kills in KV (1h TTL)
 *   claim → verify the player won AMBUSH_KILLS_REQUIRED more fights since (cleared
 *           the gauntlet), roll the reward server-side, grant under the save lock,
 *           consume the token. Daily-capped.
 * The reward is recomputed/rolled here, never trusted from the client.
 */

const TOKEN_TTL_SECONDS = 60 * 60;
const tokenKeyFor = (player: string) => `wanderer-ambush:${player}`;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `wanderer-ambush-${action}`, 20, 60_000, identity.name))) return;

        const tokenKey = tokenKeyFor(playerName);

        // ── START: seal the foe-kill baseline ─────────────────────────────────
        if (action === 'start') {
            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !char) return res.status(404).json({ error: 'Your save was not found.' });
            await kv.set(tokenKey, { baseline: num(char.totalAiKills), at: Date.now() }, { ex: TOKEN_TTL_SECONDS });
            return res.status(200).json({ ok: true });
        }

        // ── CLAIM: verify the gauntlet was cleared, then pay ──────────────────
        if (action === 'claim') {
            const sealed = await kv.get<{ baseline: number }>(tokenKey);
            if (!sealed) return res.status(200).json({ ok: false, reason: 'none' });

            const today = utcDateKey();
            const claimedToday = await kv.incr(`wanderer-ambush-count:${playerName}:${today}`, { ex: 25 * 60 * 60 });
            if (claimedToday > AMBUSH_REWARDS_PER_DAY) {
                return res.status(200).json({ ok: false, reason: 'daily-cap' });
            }

            const out = await withKvLock<{ status: number; body: unknown }>(`save:${playerName}`, async () => {
                const fresh = await kv.get<{ baseline: number }>(tokenKey);
                if (!fresh) return { status: 200, body: { ok: false, reason: 'none' } };

                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

                if (!ambushCleared(num(fresh.baseline), num(char.totalAiKills))) {
                    return { status: 200, body: { ok: false, reason: 'incomplete' } };
                }

                const reward = rollAmbushReward(num(char.level) || 1, Math.random);
                const updated = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    fateShards: num(char.fateShards) + reward.fateShards,
                    boneCharms: num(char.boneCharms) + reward.boneCharms,
                };
                await kv.set(`save:${playerName}`, mergePreservingImages({ ...rec, character: updated }, rec));
                await kv.del(tokenKey).catch(() => undefined);
                return {
                    status: 200,
                    body: {
                        ok: true,
                        reward,
                        totals: { ryo: updated.ryo, fateShards: updated.fateShards, boneCharms: updated.boneCharms },
                    },
                };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not grant the reward — please retry.' });
        }
        console.error('[sector/wanderer-ambush]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
