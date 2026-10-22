import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import { rollBlackMarket, settleBlackMarketPull, BLACK_MARKET_DAILY_CAP } from './_black-market.js';
import { recordEconomyTxn } from '../_economy.js';
import { brokerDailyUsed, type BrokerCrateLedger } from '../../shared/sunscar/broker-certificates.js';
import { LockContendedError } from '../_lock.js';

/*
 * /api/festival/black-market — GET today's count; POST one ryo/certificate pull
 *
 * Server-authoritative gamble in the Sunscar Festival. Fully resolved on the
 * server in one shot (no client-reported outcome): through mutatePlayerSave,
 * under the save lock, we check the daily cap + balance, debit the COST, roll
 * the payout server-side, credit it, and bump the per-day counter. The client
 * only renders what we return.
 *
 *   GET  ?playerName=   → { ok, dailyUsed, dailyCap, day }   (read-only)
 *   POST { playerName, payment?: 'ryo' | 'certificate', requestId? } → { ok, cost, payment, reward, dailyUsed, dailyCap, day, balanceRyo }
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
        const payment = body.payment === undefined ? 'ryo' : body.payment;
        if (!isGet && payment !== 'ryo' && payment !== 'certificate') return res.status(400).json({ error: 'Choose ryo or a Broker certificate.' });
        const requestId = body.requestId;
        if (!isGet && requestId !== undefined && (typeof requestId !== 'string' || !/^\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]{8,64}$/.test(requestId))) {
            return res.status(400).json({ error: 'Invalid crate request. Refresh the Broker and try again.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        // Reading the count has its own bucket, so the profile card checking it
        // can never spend the rate limit a real pull needs.
        if (!identity.admin && !(await enforceRateLimitKv(req, res, isGet ? 'black-market-usage' : 'black-market', 30, 60_000, identity.name))) return;

        const now = Date.now();
        // Both readers use the co-written save ledger, with the old counter as
        // a migration floor for pulls made before this ledger was introduced.
        if (isGet) {
            const day = dateKeyUTC(Date.now());
            const [save, legacy] = await Promise.all([
                kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`),
                kv.get<number>(`${COUNT_PREFIX}${playerName}:${day}`),
            ]);
            const used = brokerDailyUsed(save?.character ?? {}, day, legacy);
            return res.status(200).json({ ok: true, dailyUsed: used, dailyCap: BLACK_MARKET_DAILY_CAP, day });
        }

        type Reply = { status: number; body: Record<string, unknown> };
        let committed: PlayerSaveMutationResult<Reply>;
        try {
            committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                // Choose the day after obtaining the lock, including requests
                // that waited for another save across midnight UTC.
                const day = dateKeyUTC(Date.now());
                const countKey = `${COUNT_PREFIX}${playerName}:${day}`;
                const used = brokerDailyUsed(char, day, await kv.get<number>(countKey));
                const ledger = char.brokerCrateLedger as BrokerCrateLedger | undefined;
                const receipts = Array.isArray(ledger?.receipts) ? ledger.receipts : [];
                const receipt = typeof requestId === 'string' ? receipts.find(entry => entry.requestId === requestId) : undefined;
                if (receipt) {
                    if (receipt.payment !== payment) return { ok: true, write: false, character: char, value: { status: 409, body: { error: 'This crate request already used another payment method.' } } };
                    return { ok: true, write: false, character: char, value: { status: 200, body: {
                        ok: true, ...receipt, replayed: true, day, dailyUsed: used, dailyCap: BLACK_MARKET_DAILY_CAP, balanceRyo: num(char.ryo),
                    } } };
                }
                if (typeof requestId === 'string') {
                    const requestDay = requestId.slice(0, 10);
                    const yesterday = dateKeyUTC(Date.parse(`${day}T00:00:00Z`) - 86_400_000);
                    // Twenty receipts cover every allowed pull today and
                    // yesterday. Older, unrecorded IDs must never charge anew.
                    if (requestDay !== day && requestDay !== yesterday) return { ok: true, write: false, character: char, value: { status: 409, body: { error: 'This crate request expired. Check your purse and certificates, then try again.' } } };
                }
                const settled = settleBlackMarketPull({ character: char, used, roll: rollBlackMarket(Math.random), payment: payment as 'ryo' | 'certificate' });
                if (!settled.ok) return { ok: true, write: false, character: char, value: { status: settled.status, body: { ...settled.body, day } } };

                const { reward, nextCharacter: nextChar, nextUsed } = settled;
                nextChar.brokerCrateLedger = {
                    day, used: nextUsed, receipts: [
                        ...(typeof requestId === 'string' ? [{ requestId, payment: payment as 'ryo' | 'certificate', cost: settled.cost, reward }] : []),
                        ...receipts,
                    ].slice(0, BLACK_MARKET_DAILY_CAP * 2),
                } satisfies BrokerCrateLedger;
                return {
                    ok: true,
                    character: nextChar,
                    value: {
                        status: 200,
                        body: {
                            ok: true,
                            cost: settled.cost,
                            payment,
                            day,
                            reward,
                            dailyUsed: nextUsed,
                            dailyCap: BLACK_MARKET_DAILY_CAP,
                            balanceRyo: num(nextChar.ryo),
                        },
                    },
                    // Compatibility mirror only: its failure cannot undo a
                    // successful pull or bypass the authoritative save count.
                    afterCommit: () => kv.set(countKey, nextUsed, { ex: COUNT_TTL_SECONDS } as never).then(() => undefined).catch(() => undefined),
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
        // A refusal also refreshes a stale device's purse/certificates (for
        // example, after another device spent the last certificate).
        out.body.character = committed.character;
        out.body._saveVersion = committed._saveVersion;

        if (out.status === 200 && !out.body.replayed) {
            const eventId = typeof requestId === 'string' ? requestId : String(now);
            await kv.set(`audit:black-market:${playerName}:${eventId}`, { ts: now, player: playerName, cost: out.body.cost, payment, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            // Log paid stakes and payouts separately. Certificate pulls have no
            // ryo stake, so telemetry must not record a fictitious debit.
            const reward = (out.body.reward ?? {}) as { ryo?: number; fateShards?: number; boneCharms?: number; auraStones?: number };
            if (Number(out.body.cost) > 0) await recordEconomyTxn({ txnId: `black-market:${playerName}:${eventId}`, player: playerName, currency: 'ryo', delta: -Number(out.body.cost), source: 'blackmarket.stake' });
            if (Number(reward.ryo) > 0) {
                await recordEconomyTxn({ txnId: `black-market-payout:${playerName}:${eventId}`, player: playerName, currency: 'ryo', delta: Number(reward.ryo), source: 'blackmarket.payout' });
            }
            if (Number(reward.fateShards) > 0) {
                await recordEconomyTxn({ txnId: `black-market-shards:${playerName}:${eventId}`, player: playerName, currency: 'fateShards', delta: Number(reward.fateShards), source: 'blackmarket.payout' });
            }
            // The relic cache and the jackpot also pay Bone Charms and Aura
            // Stones (~0.53 BC and ~0.26 AS a pull); without these rows the
            // ledger's faucets-by-source never saw them (I-19).
            if (Number(reward.boneCharms) > 0) {
                await recordEconomyTxn({ txnId: `black-market-bc:${playerName}:${eventId}`, player: playerName, currency: 'boneCharms', delta: Number(reward.boneCharms), source: 'blackmarket.payout' });
            }
            if (Number(reward.auraStones) > 0) {
                await recordEconomyTxn({ txnId: `black-market-as:${playerName}:${eventId}`, player: playerName, currency: 'auraStones', delta: Number(reward.auraStones), source: 'blackmarket.payout' });
            }
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        if (err instanceof LockContendedError) return res.status(503).json({ error: 'Your crate is saving. Retry the same request in a moment.' });
        if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid crate request.' });
        console.error('[festival/black-market]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
