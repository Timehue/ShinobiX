import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import { manualWarfrontAttemptKey } from './_warfront-council.js';
import {
    reconcileWarfrontActiveAuthorization,
    warfrontActiveAuthorizationKey,
    warfrontForfeitLeaseUntil,
} from './_warfront-lease.js';
export {
    WARFRONT_FORFEIT_MAX_COOLDOWN_SECONDS,
    warfrontForfeitLeaseUntil,
} from './_warfront-lease.js';
import {
    appendWarfrontSettlementReceipt,
    findWarfrontSettlementReceipt,
    findWarfrontSettlementReceiptByReportKey,
    nextWarfrontCoachMasteryReceipt,
    warfrontReceiptResponse,
    type WarfrontSettlementReceipt,
} from './battle-result.js';

type WarfrontToken = {
    playerName?: string;
    reportKey?: string;
    mode?: string;
    notBefore?: number;
};

function validTokenData(value: WarfrontToken | null, playerName: string, reportKey: string): value is WarfrontToken {
    return value?.mode === 'warfront'
        && String(value.playerName ?? '').toLowerCase() === playerName.toLowerCase()
        && value.reportKey === reportKey;
}

function responseFromReceipt(
    receipt: WarfrontSettlementReceipt,
    character: Record<string, unknown>,
    saveVersion: number,
    idempotentReplay: boolean,
) {
    return {
        ...warfrontReceiptResponse(receipt, character, saveVersion),
        idempotentReplay,
    };
}

/**
 * POST /api/pet/warfront-forfeit
 *
 * An authenticated emergency exit that settles the exact active Warfront as a
 * zero-value loss immediately. The durable receipt is committed before the
 * one-use token and active lease are released. Since ordinary result settlement
 * takes the same save lock and dedupes by reportKey, settle-vs-forfeit races can
 * produce exactly one receipt and never two rewards.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const battleTokenRaw = typeof body.battleToken === 'string' ? body.battleToken.trim() : '';
        const battleToken = /^[A-Za-z0-9]{16,128}$/.test(battleTokenRaw) ? battleTokenRaw : '';
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!battleToken || !reportKey) return res.status(400).json({ error: 'A valid Warfront token and report key are required.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only forfeit your own Warfront.' });
        if (!identity.admin && !(await enforceRateLimitKv(
            req,
            res,
            'warfront-forfeit',
            30,
            60_000,
            identity.name,
            { strict: true },
        ))) return;

        const tokenKey = `pet:battle-token:${playerName}:${battleToken}`;
        const saveKey = `save:${playerName}`;
        const tokenData = await kv.get<WarfrontToken>(tokenKey);
        if (tokenData && tokenData.mode !== 'warfront') {
            return res.status(403).json({ error: 'This token is not a Warfront authorization.' });
        }
        if (tokenData && !validTokenData(tokenData, playerName, reportKey)) {
            return res.status(403).json({ error: 'Warfront token does not match this report.' });
        }

        // A lost first response reaches this path after token deletion. Replay
        // only the durable receipt; never synthesize a second settlement.
        if (!tokenData) {
            const settled = await kv.get<Record<string, unknown>>(saveKey);
            const character = settled?.character as Record<string, unknown> | undefined;
            const receipt = findWarfrontSettlementReceipt(character, battleToken, reportKey)
                ?? findWarfrontSettlementReceiptByReportKey(character, reportKey);
            if (receipt && character) {
                await reconcileWarfrontActiveAuthorization(playerName, battleToken, reportKey, receipt);
                return res.status(200).json(responseFromReceipt(
                    receipt,
                    character,
                    Number(settled?._saveVersion ?? 0),
                    true,
                ));
            }
            // Council can legitimately outlive the one-hour redeemable token.
            // In that case there is no settlement to recover, but the
            // authenticated holder still needs a terminal acknowledgement so
            // the UI cannot strand them in the arena. Inspect the player-wide
            // lease under its lock: an absent lease (or this exact stale lease)
            // is safe to abandon, while any different value belongs to a newer
            // prepare/start/match and must never be cleared by the old request.
            const activeKey = warfrontActiveAuthorizationKey(playerName);
            const expiredExit = await withKvLock(activeKey, async () => {
                const active = await kv.get<unknown>(activeKey);
                if (active === battleToken) {
                    await kv.delIfEqual(activeKey, battleToken);
                    return { safe: true } as const;
                }
                if (active === null) return { safe: true } as const;
                return { safe: false } as const;
            }, { failClosed: true });
            if (!expiredExit.safe) {
                return res.status(409).json({
                    error: 'A different Warfront authorization is active. This expired request cannot release it.',
                    code: 'warfront-active-authorization-mismatch',
                    activeMatch: true,
                    safeToExit: false,
                });
            }
            return res.status(200).json({
                ok: true,
                outcome: 'loss',
                reward: 0,
                forfeited: true,
                safeToExit: true,
                expiredAuthorization: true,
                settlementReceipt: null,
                reason: 'warfront-authorization-expired',
                idempotentReplay: true,
            });
        }

        const settled = await withKvLock(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const character = record?.character as Record<string, unknown> | undefined;
            if (!record || !character) return { error: 'no-save' as const };

            const existing = findWarfrontSettlementReceipt(character, battleToken, reportKey)
                ?? findWarfrontSettlementReceiptByReportKey(character, reportKey);
            if (existing) {
                await kv.del(tokenKey).catch(() => undefined);
                return {
                    receipt: existing,
                    character,
                    saveVersion: Number(record._saveVersion ?? 0),
                    idempotentReplay: true,
                };
            }

            // Re-read after acquiring the same save lock used by normal result
            // settlement. If it vanished, a concurrent path won and its receipt
            // must be observed on retry instead of creating a second result.
            const liveToken = await kv.get<WarfrontToken>(tokenKey);
            if (!validTokenData(liveToken, playerName, reportKey)) return { error: 'settlement-race' as const };

            const today = new Date().toISOString().slice(0, 10);
            const settledAt = Date.now();
            const leaseHeldUntil = warfrontForfeitLeaseUntil(liveToken, settledAt);
            const lastReset = String(character.lastDailyReset ?? '');
            const dailyPetWins = lastReset === today ? Number(character.dailyPetWins ?? 0) : 0;
            const coachMastery = nextWarfrontCoachMasteryReceipt(character, today, false);
            const receipt: WarfrontSettlementReceipt = {
                battleToken,
                reportKey,
                outcome: 'loss',
                reward: 0,
                firstWinOfDay: false,
                firstWinBonus: 0,
                capped: false,
                rewardEligible: false,
                forfeited: true,
                ...(leaseHeldUntil > settledAt ? { leaseHeldUntil } : {}),
                coachMastery,
                totalPetWins: Number(character.totalPetWins ?? 0),
                dailyPetWins,
                settledAt,
            };
            const priorTokens = Array.isArray(character.redeemedPetBattleTokens)
                ? (character.redeemedPetBattleTokens as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
                : [];
            const recordedCharacter = appendWarfrontSettlementReceipt({
                ...character,
                redeemedPetBattleTokens: priorTokens.includes(battleToken) ? priorTokens : [...priorTokens, battleToken],
            }, receipt);
            const updated = bumpSaveVersion({ ...record, character: recordedCharacter });
            await writeSaveProjected(saveKey, updated, record);
            await kv.del(tokenKey).catch(() => undefined);
            await kv.del(manualWarfrontAttemptKey(playerName, battleToken)).catch(() => undefined);
            return {
                receipt,
                character: recordedCharacter,
                saveVersion: Number((updated as Record<string, unknown>)._saveVersion ?? 0),
                idempotentReplay: false,
            };
        }, { failClosed: true });

        if ('error' in settled) {
            if (settled.error === 'no-save') return res.status(404).json({ error: 'Player save not found.' });
            return res.status(409).json({
                error: 'This Warfront settled concurrently. Retry to recover its receipt.',
                code: 'warfront-settlement-race',
            });
        }

        // Consume the redeemable token lease, but keep a bounded non-searchable
        // marker until the original match maturity. Without it a modified
        // client could offline-sim the revealed seed, forfeit losses, and roll
        // fresh scouting contracts until it found a win.
        await reconcileWarfrontActiveAuthorization(playerName, battleToken, reportKey, settled.receipt);
        return res.status(200).json(responseFromReceipt(
            settled.receipt,
            settled.character,
            settled.saveVersion,
            settled.idempotentReplay,
        ));
    } catch (error) {
        console.error('[pet/warfront-forfeit]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
