import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { applyDerivedLevel, type XpCharacter } from '../_xp-engine.js';
import { kv } from '../_storage.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { beginDurableSettlement, cancelDurableSettlement, completeDurableSettlement, getDurableSettlement, listDurableSettlements, settlementFingerprint, settlementTransactionId, updateDurableSettlement } from '../_durable-settlement.js';
import { recordEconomyTxn } from '../_economy.js';
import {
    cleanMiraaBet,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    MIRAA_DAILY_WAGER_CAP,
    MIRAA_TOKEN_TTL_SECONDS,
    resolveMiraaWager,
    rollFateDice,
    utcDateKey,
} from './_sunscar.js';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function requestKey(raw: unknown, fallback: string): string {
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value && /^[A-Za-z0-9_-]{8,96}$/.test(value) ? value : fallback;
}

// randomUUID is backed by the platform CSPRNG. Persisting a unit interval at
// wager creation means a payout retry can reproduce the same server result
// even when the result-marker write failed after the roll was computed.
function secureRandomUnit(): number {
    return Number.parseInt(randomUUID().replace(/-/g, '').slice(0, 8), 16) / 0x1_0000_0000;
}

function receiptValue(character: Record<string, unknown>, txId: string, fingerprint: string): Record<string, unknown> | null {
    const raw = character.serverSettlementReceipts;
    if (!Array.isArray(raw)) return null;
    const found = raw.find((entry) => entry && typeof entry === 'object'
        && (entry as Record<string, unknown>).requestId === txId) as Record<string, unknown> | undefined;
    if (!found || found.fingerprint !== fingerprint || !found.value || typeof found.value !== 'object') return null;
    return found.value as Record<string, unknown>;
}

function appendPlayerSettlementReceipt(
    character: Record<string, unknown>,
    txId: string,
    fingerprint: string,
    value: Record<string, unknown>,
): Record<string, unknown> {
    const current = Array.isArray(character.serverSettlementReceipts) ? character.serverSettlementReceipts : [];
    return {
        ...character,
        serverSettlementReceipts: [
            { requestId: txId, fingerprint, value, settledAt: Date.now() },
            ...current.filter((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).requestId !== txId),
        ].slice(0, 50),
    };
}

/*
 * /api/festival/sunscar - POST
 *
 * Server-side Sunscar settlement. Every payout is decided here — the client is
 * never trusted for a ryo outcome:
 *   - `dice`  — fully rolled + paid server-side (fixed cost, daily cap).
 *   - `miraa` — a wager on server-authoritative Shinobi Chronicle Showdown whose outcome the
 *     client owns and cannot be verified cheaply. Settled via the mint-token
 *     escrow pattern: `miraa-start` debits the stake and seals `bet` into a
 *     durable token; `miraa-report` settles it idempotently and SERVER-ROLLS the
 *     result (see resolveMiraaWager), ignoring any client-reported outcome. The
 *     legacy client-attested `kind:'miraa'` path (a ryo mint) is retired below.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const kind = String(body.kind ?? '');
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only act for your own account.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sunscar-festival', 40, 60_000, identity.name))) return;

        if (kind === 'dice') {
            const today = utcDateKey();
            const out = await mutatePlayerSave(playerName, ({ character }) => {
                const used = String(character.lastDailyReset ?? '') === today
                    ? Math.max(0, Math.floor(Number(character.dailyFateSpins ?? 0) || 0))
                    : 0;
                if (used >= FATE_DICE_DAILY_CAP) {
                    return {
                        ok: false,
                        status: 429,
                        error: `The dice grow cold. Your fate is spent for today (${FATE_DICE_DAILY_CAP}/${FATE_DICE_DAILY_CAP}).`,
                    };
                }
                if (num(character.ryo) < FATE_DICE_COST) {
                    return { ok: false, status: 400, error: `Not enough ryo. A roll costs ${FATE_DICE_COST}.` };
                }

                const result = rollFateDice(Math.random);
                // Character XP is retired: the dice grant tiny stat-pool points
                // instead, then the rise-only derived-level recompute runs.
                const paid = {
                    ...character,
                    ryo: num(character.ryo) - FATE_DICE_COST,
                    unspentStats: Math.max(0, Math.floor(num(character.unspentStats))) + Math.max(0, Math.floor(result.reward.statPoints)),
                } as XpCharacter;
                const leveled = applyDerivedLevel(paid) as unknown as Record<string, unknown>;
                const nextCharacter = {
                    ...character,
                    ...leveled,
                    ryo: num(leveled.ryo) + result.reward.ryo,
                    stamina: Math.min(num(leveled.maxStamina), num(leveled.stamina) + result.reward.stamina),
                    boneCharms: num(leveled.boneCharms) + result.reward.boneCharms,
                    fateShards: num(leveled.fateShards) + result.reward.fateShards,
                    auraStones: num(leveled.auraStones) + result.reward.auraStones,
                    dailyFateSpins: used + 1,
                    lastDailyReset: today,
                };
                return { ok: true, character: nextCharacter, value: { ...result, dailyUsed: used + 1, dailyCap: FATE_DICE_DAILY_CAP, cost: FATE_DICE_COST } };
            });
            if (!out.ok) return res.status(out.status).json({ error: out.error });
            // Economy telemetry — the dice stake is a flat ryo sink. Fate Shards
            // only appear on the triple-eye branch, so they are logged from the
            // sealed result rather than assumed.
            await recordEconomyTxn({ txnId: `fate-dice:${playerName}:${Date.now()}`, player: playerName, currency: 'ryo', delta: -FATE_DICE_COST, source: 'sunscar.dice' });
            const diceShards = Number((out.value as { reward?: { fateShards?: number } }).reward?.fateShards ?? 0);
            if (diceShards > 0) {
                await recordEconomyTxn({ txnId: `fate-dice-shards:${playerName}:${Date.now()}`, player: playerName, currency: 'fateShards', delta: diceShards, source: 'sunscar.dice' });
            }
            return res.status(200).json({ ok: true, ...out.value, character: out.character, _saveVersion: out._saveVersion });
        }

        // Miraa wager — open (escrow the stake + mint a single-use token). The
        // stake is committed here BEFORE the (server-rolled) result is known, so a
        // client can't cherry-pick which wagers to settle.
        if (kind === 'miraa-start') {
            const bet = cleanMiraaBet(body.bet);
            if (!bet) return res.status(400).json({ error: 'Invalid Miraa wager.' });
            const fp = settlementFingerprint({ operation: 'miraa-start', playerName, bet });
            const idempotencyKey = requestKey(body.requestId, `legacy-miraa-start-${playerName}-${Date.now()}-${randomUUID().replace(/-/g, '')}`);
            const txId = settlementTransactionId('miraa-start', `${playerName}:${idempotencyKey}`);
            const initial = await beginDurableSettlement({
                transactionId: txId,
                idempotencyKey,
                operationType: 'miraa-start',
                fingerprint: fp,
                actorIds: [playerName],
                resource: 'ryo',
                amount: bet,
                meta: { playerName, bet, rollSeed: secureRandomUnit() },
            }, { kv });
            if (initial.status === 'conflict') return res.status(409).json({ error: 'That Miraa request ID belongs to a different wager.' });
            if (initial.record.state === 'completed' && initial.record.result) {
                return res.status(200).json({ ok: true, ...initial.record.result });
            }

            const tokenId = String(initial.record.meta?.token ?? randomUUID().replace(/-/g, ''));
            await updateDurableSettlement(txId, { meta: { ...initial.record.meta, playerName, bet, token: tokenId } }, { kv });
            const out = await mutatePlayerSave(playerName, async ({ character }) => {
                const existing = receiptValue(character, txId, fp);
                if (existing) {
                    return {
                        ok: true,
                        character,
                        value: { token: String(existing.token ?? tokenId), bet, balanceRyo: num(character.ryo), character },
                    };
                }
                if (num(character.ryo) < bet) return { ok: false, status: 400, error: 'Not enough ryo for that wager.' };
                const today = utcDateKey();
                const legacyCount = Number(await kv.get<number>(`miraa-wager-count:${playerName}:${today}`) ?? 0);
                const used = String(character.miraaWagerDate ?? '') === today
                    ? Math.max(0, Math.floor(Number(character.miraaWagerCount ?? 0)))
                    : 0;
                const startedToday = Math.max(used, Number.isFinite(legacyCount) ? Math.floor(legacyCount) : 0);
                if (!identity.admin && startedToday >= MIRAA_DAILY_WAGER_CAP) {
                    return { ok: false, status: 429, error: `Miraa waves you off — you've wagered enough for one day (${MIRAA_DAILY_WAGER_CAP}/${MIRAA_DAILY_WAGER_CAP}).` };
                }
                const nextCharacter = appendPlayerSettlementReceipt({
                    ...character,
                    ryo: num(character.ryo) - bet,
                    miraaWagerDate: today,
                    miraaWagerCount: startedToday + 1,
                }, txId, fp, { kind: 'miraa-start', token: tokenId, bet });
                const value = { token: tokenId, bet, balanceRyo: num(nextCharacter.ryo), character: nextCharacter };
                return { ok: true, character: nextCharacter, value };
            });
            if (!out.ok) {
                await cancelDurableSettlement(txId, { status: out.status, error: out.error }, { kv }).catch(() => undefined);
                return res.status(out.status).json({ error: out.error });
            }
            const result = { token: tokenId, bet, balanceRyo: Number(out.value.balanceRyo), character: out.character, _saveVersion: out._saveVersion };
            await kv.set(`miraa-token:${playerName}:${tokenId}`, { playerName, bet, transactionId: txId, mintedAt: Date.now() }, { ex: MIRAA_TOKEN_TTL_SECONDS });
            await completeDurableSettlement(txId, result, { kv });
            return res.status(200).json({ ok: true, ...result });
        }

        // Miraa wager — settle the durable token, then use the sealed server roll
        // outcome from the sealed bet. The client's card result / any body.outcome
        // is ignored; the stake was already escrowed at start, so we only credit
        // winnings on a server-rolled win.
        if (kind === 'miraa-report') {
            const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
            const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
            if (!token) return res.status(400).json({ error: 'Missing or invalid Miraa wager token.' });
            const forfeit = body.forfeit === true;

            let tokenRecord = await kv.get<{ playerName?: string; bet?: number; transactionId?: string }>(`miraa-token:${playerName}:${token}`);
            // A token may have expired after the player opened a valid wager.
            // The durable start journal is retained longer than the client
            // token, so recover the sealed bet and transaction identity instead
            // of turning an in-flight wager into an unrecoverable loss.
            if (!tokenRecord) {
                const startSettlement = (await listDurableSettlements({ kv }))
                    .find((record) => record.operationType === 'miraa-start'
                        && record.actorIds.some((actor) => actor.toLowerCase() === playerName.toLowerCase())
                        && String(record.meta?.token ?? '') === token);
                if (startSettlement) {
                    tokenRecord = {
                        playerName,
                        bet: Number(startSettlement.meta?.bet ?? startSettlement.amount),
                        transactionId: startSettlement.transactionId,
                    };
                }
            }
            if (tokenRecord && String(tokenRecord.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return res.status(403).json({ error: 'That wager does not belong to you.' });
            }
            const bet = cleanMiraaBet(tokenRecord?.bet);
            if (!bet) return res.status(400).json({ error: 'Corrupt Miraa wager.' });
            const startSettlement = tokenRecord?.transactionId
                ? await getDurableSettlement(tokenRecord.transactionId, { kv })
                : null;
            const txId = settlementTransactionId('miraa-report', `${playerName}:${token}`);
            const fp = settlementFingerprint({ operation: 'miraa-report', playerName, token });
            const existingTx = await getDurableSettlement(txId, { kv });
            if (!existingTx) {
                const created = await beginDurableSettlement({
                    transactionId: txId,
                    idempotencyKey: token,
                    operationType: 'miraa-report',
                    fingerprint: fp,
                    actorIds: [playerName],
                    resource: 'ryo',
                    amount: bet,
                    meta: {
                        playerName,
                        bet,
                        token,
                        ...(Number.isFinite(Number(startSettlement?.meta?.rollSeed)) ? { rollSeed: Number(startSettlement?.meta?.rollSeed) } : {}),
                    },
                }, { kv });
                if (created.status === 'conflict') return res.status(409).json({ error: 'That Miraa report conflicts with an existing settlement.' });
            }

            const reportResult = await mutatePlayerSave(playerName, async ({ character }) => {
                const currentTx = await getDurableSettlement(txId, { kv });
                if (!currentTx) return { ok: false, status: 503, error: 'Miraa settlement is not durable yet. Retry.' };
                const replay = receiptValue(character, txId, fp);
                if (replay) {
                    return {
                        ok: true,
                        character,
                        value: {
                            outcome: replay.outcome,
                            bet: Number(replay.bet ?? bet),
                            credit: Number(replay.credit ?? 0),
                            balanceRyo: num(character.ryo),
                        },
                    };
                }
                let outcome = String(currentTx.meta?.outcome ?? '');
                let credit = Number(currentTx.meta?.credit ?? NaN);
                if (outcome !== 'win' && outcome !== 'loss' && outcome !== 'forfeit') {
                    const rollSeed = Number(currentTx.meta?.rollSeed);
                    const stableSeed = Number.isFinite(rollSeed) ? rollSeed : secureRandomUnit();
                    // Seed legacy report records before applying the payout. If
                    // this write fails, no player mutation occurs and retrying
                    // uses the same seed rather than rerolling.
                    const rolled = resolveMiraaWager(bet, forfeit, () => stableSeed);
                    outcome = rolled.outcome;
                    credit = rolled.credit;
                    await updateDurableSettlement(txId, {
                        state: 'reserved',
                        meta: { ...(currentTx.meta ?? {}), playerName, bet, token, rollSeed: stableSeed, outcome, credit },
                    }, { kv });
                }
                const nextCharacter = appendPlayerSettlementReceipt({
                    ...character,
                    ryo: num(character.ryo) + credit,
                }, txId, fp, { kind: 'miraa-report', token, outcome, bet, credit });
                const value = { outcome, bet, credit, balanceRyo: num(nextCharacter.ryo), character: nextCharacter };
                return { ok: true, character: nextCharacter, value };
            });
            if (!reportResult.ok) return res.status(reportResult.status).json({ error: reportResult.error });
            const result = { ...reportResult.value, character: reportResult.character, _saveVersion: reportResult._saveVersion };
            await completeDurableSettlement(txId, result, { kv });
            await kv.set(`miraa-token:${playerName}:${token}`, { ...(tokenRecord ?? {}), playerName, bet, transactionId: txId, completedAt: Date.now() }, { ex: MIRAA_TOKEN_TTL_SECONDS });
            return res.status(200).json({ ok: true, ...result });
        }

        // Retired: the old client-attested Miraa settlement trusted body.outcome
        // and paid bet×2 on a claimed 'win' with no stake deduction — a straight
        // ryo mint. Stale clients get a clear refresh signal, never a payout.
        if (kind === 'miraa') {
            return res.status(410).json({ error: 'Refresh the festival — the Miraa wager moved to a new, secure flow.' });
        }

        return res.status(400).json({ error: 'Unknown festival action.' });
    } catch (err) {
        console.error('[festival/sunscar]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
