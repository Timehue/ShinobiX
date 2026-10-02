import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import { rollBlackMarket, settleBlackMarketPull, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP } from './_black-market.js';
import { recordEconomyTxn } from '../_economy.js';

/*
 * /api/festival/black-market — GET today's crate count; POST one ryo-gamble pull
 *
 * Server-authoritative gamble in the Sunscar Festival. Fully resolved on the
 * server in one shot (no client-reported outcome): through mutatePlayerSave,
 * under the save lock, we check the daily cap + balance, debit the COST, roll
 * the payout server-side, credit it, and bump the per-day counter. The client
 * only renders what we return.
 *
 *   GET  ?playerName=   → { ok, dailyUsed, dailyCap, day }   (read-only)
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
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    const isGet = req.method === 'GET';
    if (!isGet && req.method !== 'POST') return res.status(405).end();

    try {
        const body = (isGet ? {} : typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(isGet ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        // Reading the count has its own bucket, so the profile card checking it
        // can never spend the rate limit a real pull needs.
        if (!identity.admin && !(await enforceRateLimitKv(req, res, isGet ? 'black-market-usage' : 'black-market', 30, 60_000, identity.name))) return;

        const now = Date.now();
        const day = dateKeyUTC(now);
        const countKey = `${COUNT_PREFIX}${playerName}:${day}`;

        // GET: today's pull count, read-only, for the daily-caps grid on the
        // player card. The counter key is the same one the POST path enforces.
        if (isGet) {
            const used = num(await kv.get<number>(countKey));
            return res.status(200).json({ ok: true, dailyUsed: used, dailyCap: BLACK_MARKET_DAILY_CAP, day });
        }

        type Reply = { status: number; body: Record<string, unknown> };
        let committed: PlayerSaveMutationResult<Reply>;
        try {
            // Not retried after a lost compare-and-set: every pull is a fresh
            // gamble with no receipt, and nothing was charged, so the player
            // simply pulls again.
            committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                const used = num(await kv.get<number>(countKey));
                const settled = settleBlackMarketPull({ character: char, used, roll: rollBlackMarket(Math.random) });
                if (!settled.ok) return { ok: true, write: false, character: char, value: { status: settled.status, body: settled.body } };

                const { reward, nextCharacter: nextChar, nextUsed } = settled;
                return {
                    ok: true,
                    character: nextChar,
                    value: {
                        status: 200,
                        body: {
                            ok: true,
                            cost: BLACK_MARKET_COST,
                            reward,
                            dailyUsed: nextUsed,
                            dailyCap: BLACK_MARKET_DAILY_CAP,
                            balanceRyo: num(nextChar.ryo),
                        },
                    },
                    // Save BEFORE the counter, deliberately: a crash between them
                    // costs the house one uncounted pull, never the player a
                    // paid-for one. The counter still lands under the save lock,
                    // so the next pull reads it.
                    afterCommit: () => kv.set(countKey, nextUsed, { ex: COUNT_TTL_SECONDS } as never).then(() => undefined),
                };
            });
        } catch (err) {
            if (isPlayerSaveVersionConflict(err)) return res.status(503).json(SAVE_VERSION_CONFLICT_REPLY);
            throw err;
        }
        if (!committed.ok) {
            if (committed.status === 404) return res.status(404).json({ error: 'Your save was not found.' });
            return res.status(committed.status).json({ error: committed.error });
        }
        const out = committed.value;
        if (out.status === 200) {
            out.body.character = committed.character;
            out.body._saveVersion = committed._saveVersion;
        }

        if (out.status === 200) {
            await kv.set(`audit:black-market:${now}`, { ts: now, player: playerName, cost: BLACK_MARKET_COST, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            // Economy telemetry — log the pull as its two real halves. The stake is
            // a hard ryo sink on every pull; the payout is a faucet only when the
            // roll pays ryo back. Netting them would hide the gross churn, which is
            // the number that says whether this table is a sink at all.
            const reward = (out.body.reward ?? {}) as { ryo?: number; fateShards?: number };
            await recordEconomyTxn({ txnId: `black-market:${playerName}:${now}`, player: playerName, currency: 'ryo', delta: -BLACK_MARKET_COST, source: 'blackmarket.stake' });
            if (Number(reward.ryo) > 0) {
                await recordEconomyTxn({ txnId: `black-market-payout:${playerName}:${now}`, player: playerName, currency: 'ryo', delta: Number(reward.ryo), source: 'blackmarket.payout' });
            }
            if (Number(reward.fateShards) > 0) {
                await recordEconomyTxn({ txnId: `black-market-shards:${playerName}:${now}`, player: playerName, currency: 'fateShards', delta: Number(reward.fateShards), source: 'blackmarket.payout' });
            }
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[festival/black-market]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
