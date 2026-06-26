import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { rollBlackMarket, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP } from './_black-market.js';

/*
 * /api/festival/black-market — POST (one ryo-gamble pull)
 *
 * Server-authoritative gamble in the Sunscar Festival. Fully resolved on the
 * server in one shot (no client-reported outcome): under the save lock we check
 * the daily cap + balance, debit the COST, roll the payout server-side, credit
 * it, and bump the per-day counter. The client only renders what we return.
 *
 *   POST { playerName } → { ok, cost, reward, dailyUsed, dailyCap, balanceRyo }
 *
 * It is a SINK by construction (expected ryo return < cost, see _black-market.ts).
 */

const COUNT_PREFIX = 'bm:count:';
const COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function dateKeyUTC(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'black-market', 30, 60_000, identity.name))) return;

        const now = Date.now();
        const countKey = `${COUNT_PREFIX}${playerName}:${dateKeyUTC(now)}`;

        const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(`save:${playerName}`, async () => {
            const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !char) return { status: 404, body: { error: 'Your save was not found.' } };

            const used = num(await kv.get<number>(countKey));
            if (used >= BLACK_MARKET_DAILY_CAP) {
                return { status: 429, body: { error: `The black market is done with you today (${BLACK_MARKET_DAILY_CAP}/${BLACK_MARKET_DAILY_CAP}). Return after midnight UTC.`, dailyUsed: used, dailyCap: BLACK_MARKET_DAILY_CAP } };
            }
            if (num(char.ryo) < BLACK_MARKET_COST) {
                return { status: 400, body: { error: `Not enough ryo. A pull costs ${BLACK_MARKET_COST.toLocaleString()}.` } };
            }

            const reward = rollBlackMarket(Math.random);
            const nextChar = {
                ...char,
                ryo: num(char.ryo) - BLACK_MARKET_COST + reward.ryo,
                fateShards: num(char.fateShards) + reward.fateShards,
                boneCharms: num(char.boneCharms) + reward.boneCharms,
                auraStones: num(char.auraStones) + reward.auraStones,
                mythicSeals: num(char.mythicSeals) + reward.mythicSeals,
            };
            await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: nextChar }), rec));
            await kv.set(countKey, used + 1, { ex: COUNT_TTL_SECONDS } as never);

            return { status: 200, body: { ok: true, cost: BLACK_MARKET_COST, reward, dailyUsed: used + 1, dailyCap: BLACK_MARKET_DAILY_CAP, balanceRyo: num(nextChar.ryo) } };
        }, { failClosed: true });

        if (out.status === 200) {
            await kv.set(`audit:black-market:${now}`, { ts: now, player: playerName, cost: BLACK_MARKET_COST, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[festival/black-market]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
