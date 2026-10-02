import { safeLogValue } from '../_safe-log.js';
import { resolvePlayerReference } from '../_account-name.js';
import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { mutatePlayerSaves, PlayerSavesPartialCommitError, type PlayerSavesDecision } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import { planTrade, isTradeCurrency } from './_trade-core.js';
import { chargeOutboundBudget, checkOutboundBudget, senderTrustTier, withOutboundBudgetGate } from './_transfer-budget.js';
import { recordEconomyTxn } from '../_economy.js';
import { makeEconomyTxId, reserveEconomyTx, markEconomyTx, completeEconomyTx, failEconomyTx } from '../_economy-tx.js';

/*
 * /api/player/trade — POST (direct player-to-player transfer)
 *
 * One-way taxed SEND. The sender is debited the full amount; the recipient
 * receives amount minus a burned tax (the economy sink). Server-authoritative:
 * balances are read fresh under BOTH save locks (mutatePlayerSaves: one sorted
 * order → no deadlock, failClosed → currency safety), the split is recomputed
 * from _trade-core, and neither side's amount comes from the client body.
 *
 *   POST { playerName, toPlayer, currency, amount, nonce }
 *     → { ok, currency, debit, credit, burned, toPlayer, senderBalance, _saveVersion }
 *
 * Money safety:
 *   - only ryo / fateShards / boneCharms / auraStones are tradeable (honor seals
 *     are Vanguard-locked, mythic seals are top-rarity — both excluded).
 *   - VOID when sender + recipient share an IP/device (no funnelling to an alt).
 *   - the client `nonce` is REQUIRED (F15, 2026-09-07): it is what makes a
 *     retried request idempotent (NX receipt). A body without one has no replay
 *     identity, so a lost response would turn the client's own retry into a
 *     second, unrelated transfer; it is answered 400 with a reload hint instead.
 *     `ALLOW_NONCELESS_TRANSFERS=1` re-admits legacy bodies without a deploy.
 */

const AUDIT_PREFIX = 'audit:player-trade:';
const NONCE_TTL_SECONDS = 24 * 60 * 60;
const PENDING_TRANSFER_ERROR = 'A previous attempt of this transfer is still settling. It was NOT sent twice — refresh your balance before retrying.';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * What one nonce is allowed to mean. A retried request that carries the same
 * nonce with a DIFFERENT recipient/currency/amount is not a retry — it is a
 * second transfer wearing the first one's receipt, and is refused.
 */
export function tradeNonceFingerprint(toSlug: string, currency: string, amount: number): string {
    return createHash('sha256').update(JSON.stringify({ to: toSlug, currency, amount })).digest('hex').slice(0, 32);
}

type NonceRecord = { receipt?: unknown; txId?: unknown; fp?: unknown; pending?: unknown };

/**
 * The answer a prior nonce record dictates, or null when the transfer may run.
 * Shared by the fast pre-lock check and the authoritative re-check under both
 * save locks, so the two can never disagree.
 */
function priorNonceAnswer(prior: NonceRecord | null, fingerprint: string): { status: number; body: Record<string, unknown> } | null {
    if (!prior) return null;
    if (typeof prior.fp === 'string' && prior.fp !== fingerprint) {
        return { status: 409, body: { error: 'That request id was already used for a different transfer.', nonceConflict: true } };
    }
    if (prior.receipt) return { status: 200, body: { ...(prior.receipt as Record<string, unknown>), duplicate: true } };
    return { status: 409, body: { error: PENDING_TRANSFER_ERROR, pending: true, txId: typeof prior.txId === 'string' ? prior.txId : undefined } };
}

type TradeReply = { status: number; body: Record<string, unknown> };

/**
 * Whether a debit that THREW provably never landed. A write can commit and still
 * throw, its reply lost on the way back; the shared writer already adopts one
 * whose read-back shows it. What reaches here is a read-back that showed
 * something else, or failed. Every save write bumps `_saveVersion`, and none can
 * land while this transfer holds the save lock, so a stored version still equal
 * to the one the decision read is proof nothing moved. A failed read, or any
 * other version, proves nothing: the debit may have landed.
 */
async function debitProvablyMissed(senderKey: string, readVersion: number): Promise<boolean> {
    const stored = await kv.get<Record<string, unknown>>(senderKey).catch(() => null);
    return !!stored && Number(stored._saveVersion ?? 0) === readVersion;
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
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'player-trade', 20, 60_000, identity.name))) return;

        const currency = String(body.currency ?? '');
        if (!isTradeCurrency(currency)) return res.status(400).json({ error: 'That currency cannot be traded.' });
        const amount = Math.floor(num(body.amount));

        const toRaw = typeof body.toPlayer === 'string' ? await resolvePlayerReference(body.toPlayer.trim()) : '';
        if (!toRaw) return res.status(400).json({ error: 'Choose a player to send to.' });
        const toSlug = safeName(toRaw);
        if (!toSlug) return res.status(400).json({ error: 'Invalid recipient.' });
        if (toSlug === playerName) return res.status(400).json({ error: "You can't send to yourself." });

        const toRec = await kv.get<Record<string, unknown>>(`save:${toSlug}`);
        const toChar = (toRec?.character ?? null) as Record<string, unknown> | null;
        if (!toRec || !toChar) return res.status(404).json({ error: 'That player was not found.' });
        const toDisplay = (toChar.name as string) ?? toRaw;

        // No funnelling currency to an account on your own connection.
        if (!identity.admin) {
            try {
                if (await hasRecentIpOrFpOverlap(playerName, toSlug)) {
                    return res.status(403).json({ error: "You can't send to someone sharing your connection." });
                }
            } catch { /* fail open — a broken anti-cheat check must not block a legit transfer */ }
        }

        // Idempotency (P0-2): the client nonce receipt is written as `pending`
        // BEFORE the sender debit, then upgraded to the final receipt after the
        // commit. Three retry cases:
        //   • prior.receipt      → the transfer committed; replay the receipt.
        //   • prior pending only → a previous attempt debited (or was about to)
        //     and never finished — the economy-tx journal has the trail. Refuse
        //     to re-run: re-running is exactly the double-debit this closes.
        //   • no prior           → first attempt (or a pre-debit failure that
        //     rolled its pending marker back); run for real.
        const nonce = typeof body.nonce === 'string' ? body.nonce.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') : '';
        // F15: no nonce, no transfer. The shipped client always sends one and
        // keeps it across retries (lib/player-trade.ts), so this only reaches a
        // tab that predates the nonce; it is told to reload rather than run a
        // transfer that cannot be made exactly-once.
        if (!nonce && process.env.ALLOW_NONCELESS_TRANSFERS !== '1') {
            return res.status(400).json({ error: 'This transfer needs a fresh session. Reload the game and try again.', reason: 'nonce-required' });
        }
        const nonceKey = nonce ? `trade:nonce:${playerName}:${nonce}` : '';
        const fingerprint = tradeNonceFingerprint(toSlug, currency, amount);
        // Fast path only. The authoritative check is repeated UNDER both save
        // locks below: this one runs before the locks, so two concurrent
        // attempts of the same nonce could both pass it. (`nonceKey` is empty
        // only under the legacy kill switch above.)
        if (nonceKey) {
            const prior = await kv.get<NonceRecord>(nonceKey);
            if (typeof prior?.fp === 'string' && prior.fp !== fingerprint) {
                return res.status(409).json({ error: 'That request id was already used for a different transfer.', nonceConflict: true });
            }
            if (prior?.receipt) return res.status(200).json({ ...(prior.receipt as Record<string, unknown>), duplicate: true });
            if (prior) {
                return res.status(409).json({
                    error: PENDING_TRANSFER_ERROR,
                    pending: true,
                    txId: typeof prior.txId === 'string' ? prior.txId : undefined,
                });
            }
        }

        const now = Date.now();
        const senderKey = `save:${playerName}`;
        const recipientKey = `save:${toSlug}`;
        // What the attempt that reached the debit left behind, for the replies
        // below. A conflict retry starts a fresh attempt, so each one resets it.
        let attempt: { txId: string; debit: number } | null = null;
        let debitOutcome: 'missed' | 'unknown' | null = null;

        // mutatePlayerSaves locks BOTH saves in one sorted order, fail-closed,
        // before reading either, so concurrent autosaves and other transfers
        // cannot clobber the read-modify-write and two trades in opposite
        // directions cannot deadlock. Each save is settled first (its idle
        // recovery included), and the writes commit sender first: debit, then
        // credit.
        const transfer = () => mutatePlayerSaves<TradeReply>([playerName, toSlug], async (sides) => {
            attempt = null;
            debitOutcome = null;
            const sender = sides[playerName]!;
            const recipient = sides[toSlug]!;
            // A refusal under the locks answers through `value` and writes
            // neither save, so every reply keeps its exact body.
            const answer = (status: number, body: Record<string, unknown>): PlayerSavesDecision<TradeReply> => ({
                ok: true,
                value: { status, body },
                sides: {
                    [playerName]: { character: sender.character, write: false },
                    [toSlug]: { character: recipient.character, write: false },
                },
            });

            const plan = planTrade(currency, amount, num(sender.character[currency]));
            if (!plan.ok) return answer(400, { error: plan.reason });

            // Rolling 24h SEND-side ceiling, checked under the same locks the
            // debit runs under so two concurrent transfers cannot both pass a
            // pre-lock check and jointly exceed it. The per-transfer cap alone
            // left the real ceiling at 20 calls/min x 200,000 = 4,000,000 ryo a
            // minute. Nothing is added to RECEIVING: RuneScape ran that
            // experiment in 2008 and removed it in 2011 for breaking ordinary
            // play. (MMORPG behavior audit F8.)
            if (!identity.admin) {
                const tier = await senderTrustTier(playerName, sender.character);
                const budget = await checkOutboundBudget(playerName, currency, plan.debit, tier);
                if (!budget.ok) {
                    return answer(429, { error: budget.error, reason: 'transfer-budget', remaining: budget.remaining, limit: budget.limit });
                }
            }

            // The nonce is re-checked HERE, under the serialization
            // boundary. Two attempts of the same nonce that both passed the
            // pre-lock check are now serialized by the save locks: the
            // second one sees the first one's pending marker or receipt.
            if (nonceKey) {
                const prior = priorNonceAnswer(await kv.get<NonceRecord>(nonceKey), fingerprint);
                if (prior) return answer(prior.status, prior.body);
            }

            // P0-2: journal the two-save settlement (reserve → debit-applied
            // → complete / needs-reconcile) so a failure between the two
            // writes leaves a durable reconcile trail (admin
            // economy-reconcile) instead of silently burning the sender's
            // funds — the pattern treasury transfers already use.
            const txId = makeEconomyTxId('player-trade');
            await reserveEconomyTx({
                id: txId, kind: 'player-trade',
                debitKey: senderKey, creditKey: recipientKey,
                resource: currency, amount: plan.debit,
                meta: { credit: plan.credit, burned: plan.burned, nonce: nonce || undefined },
            });
            // Pending nonce marker BEFORE the debit: a retry of anything
            // that fails past this point sees it and refuses to re-debit.
            // The NX result is HONORED: the old `.catch(() => undefined)`
            // ignored both a lost claim and a thrown write, and ran the debit
            // regardless — which is exactly the double-debit this closes.
            if (nonceKey) {
                const marker = { ts: now, txId, pending: true, fp: fingerprint };
                let claimed: 'OK' | null;
                try {
                    claimed = await kv.set(nonceKey, marker, { ex: NONCE_TTL_SECONDS, nx: true });
                } catch (err) {
                    // The claim may have committed with a lost acknowledgement.
                    const readback = await kv.get<NonceRecord>(nonceKey).catch(() => null);
                    if (readback?.txId === txId) {
                        claimed = 'OK';
                    } else if (readback) {
                        claimed = null;
                    } else {
                        await failEconomyTx(txId, err, { note: 'nonce claim failed; no funds moved' }).catch(() => undefined);
                        return answer(503, { error: 'The transfer could not start. Nothing was sent.', retryable: true });
                    }
                }
                if (claimed !== 'OK') {
                    // Another attempt of this exact nonce won the claim. Nothing
                    // moved here; answer from the winner's record.
                    await failEconomyTx(txId, new Error('nonce-already-claimed'), { note: 'duplicate attempt lost the nonce claim; no funds moved' }).catch(() => undefined);
                    const winner = await kv.get<NonceRecord>(nonceKey).catch(() => null);
                    const reply = priorNonceAnswer(winner, fingerprint) ?? { status: 409, body: { error: PENDING_TRANSFER_ERROR, pending: true } };
                    return answer(reply.status, reply.body);
                }
            }
            attempt = { txId, debit: plan.debit };

            // Nothing moved. Roll the pending marker back so a retry may run
            // for real, and journal the failure.
            const releaseNonce = async (error: unknown, note: string) => {
                debitOutcome = 'missed';
                if (nonceKey) await kv.del(nonceKey).catch(() => undefined);
                await failEconomyTx(txId, error, { note }).catch(() => undefined);
            };
            const readVersion = Number(sender.record._saveVersion ?? 0);
            const senderBalance = num(sender.character[currency]) - plan.debit;
            return {
                ok: true,
                value: { status: 200, body: { ok: true, currency, debit: plan.debit, credit: plan.credit, burned: plan.burned, toPlayer: toDisplay, senderBalance } },
                sides: {
                    [playerName]: {
                        character: { ...sender.character, [currency]: senderBalance },
                        // The debit committed: mark it before the credit is tried.
                        afterCommit: async () => { await markEconomyTx(txId, 'debit-applied').catch(() => undefined); },
                    },
                    [toSlug]: {
                        character: { ...recipient.character, [currency]: num(recipient.character[currency]) + plan.credit },
                    },
                },
                onConflict: (error) => releaseNonce(error, 'debit lost its compare-and-set; no funds moved'),
                // A debit can commit and still throw. Deleting the marker after
                // one that landed let the retry of the same nonce debit the
                // sender a second time, so only a proven miss releases it.
                onUnconfirmedWrite: async (error) => {
                    if (await debitProvablyMissed(senderKey, readVersion)) return releaseNonce(error, 'debit write failed; no funds moved');
                    // The debit may have landed. Keep the pending marker, which
                    // is what stops a retry from debiting again, and leave the
                    // reconcile trail.
                    debitOutcome = 'unknown';
                    await failEconomyTx(txId, error, { note: `debit of ${plan.debit} ${currency} unconfirmed; recipient not credited — reconcile` }).catch(() => undefined);
                    console.error('[player/trade] debit write unconfirmed', safeLogValue({ txId, from: playerName, to: toSlug, currency, debit: plan.debit }));
                },
                afterCommit: async () => {
                    await completeEconomyTx(txId).catch(() => undefined);
                    // Charge the rolling window INSIDE the locks, beside the debit it
                    // records. Outside them the check above is worthless: request N+1
                    // takes the locks the moment N frees them and reads a ledger N has
                    // not written yet, so 20 pipelined calls all pass and the real
                    // ceiling stays 20 x 200,000/min — the exact number this budget
                    // exists to close. Only a COMMITTED transfer is charged, so a
                    // refusal or a replay never eats budget the player did not spend.
                    if (!identity.admin) {
                        await chargeOutboundBudget(playerName, currency, plan.debit, Date.now());
                    }
                },
            };
        });

        const settle = async (): Promise<TradeReply> => {
            try {
                // A lost compare-and-set moved nothing and released its nonce,
                // so the whole transfer may run again.
                const out = await retryOnSaveVersionConflict(transfer);
                if (!out.ok) {
                    if (out.status !== 404) return { status: out.status, body: { error: out.error } };
                    return { status: 404, body: { error: out.playerName === playerName ? 'Your save was not found.' : 'That player was not found.' } };
                }
                // Hand the committed version back so the sender's open tab adopts
                // it instead of 409ing its next autosave. A refusal or a replay
                // wrote nothing, and answers exactly as it was decided.
                const senderSave = out.saves[playerName]!;
                if (!senderSave.written) return out.value;
                return { status: out.value.status, body: { ...out.value.body, _saveVersion: senderSave._saveVersion } };
            } catch (err) {
                if (err instanceof PlayerSavesPartialCommitError && attempt) {
                    // Debit committed, credit did not (or cannot be shown
                    // to have): loss-direction, never a mint. Keep the
                    // pending nonce (blocks a re-debit) and flag the journal
                    // for reconciliation.
                    const { txId, debit } = attempt;
                    await failEconomyTx(txId, err.cause, { note: `debited ${debit} ${currency}; recipient credit failed — reconcile` }).catch(() => undefined);
                    console.error('[player/trade] credit write failed after debit', safeLogValue({ txId, from: playerName, to: toSlug, currency, debit }));
                    return { status: 502, body: { error: 'The transfer was interrupted after the debit. It is recorded for restoration — do not resend.', txId } };
                }
                // Lost the compare-and-set on every try. Nothing moved, and the
                // nonce is free again.
                if (isPlayerSaveVersionConflict(err)) return { status: 409, body: { ...SAVE_VERSION_CONFLICT_REPLY } };
                if (debitOutcome === 'missed') return { status: 502, body: { error: 'The transfer could not start. Nothing was sent.' } };
                if (debitOutcome === 'unknown' && attempt) {
                    return { status: 502, body: { error: 'The transfer could not be confirmed. It is recorded for review — do not resend.', txId: attempt.txId } };
                }
                throw err;
            }
        };
        // The save locks above serialise one sender's TRADES, but the treasury
        // gifts that sender authorises draw on the same budget under other locks
        // (the treasury row and the member's save). Without the shared gate a
        // trade and a gift could both pass the check before either charged.
        // The gate is taken before the save locks and held until after the
        // charge inside them, so the budget sees one send at a time whichever
        // door it came through.
        const out = identity.admin ? await settle() : await withOutboundBudgetGate(playerName, currency, settle);

        // A replay found under the locks also answers 200, but it moved nothing:
        // writing its receipt, audit row and burn again would count one transfer
        // twice in the economy ledger.
        if (out.status === 200 && out.body.duplicate !== true) {
            // Record the idempotency receipt only on success: a retry of THIS
            // committed transfer replays it; a retry of a failed attempt (which
            // wrote no nonce) runs for real.
            if (nonceKey) {
                await kv.set(nonceKey, { ts: now, receipt: out.body, fp: fingerprint }, { ex: NONCE_TTL_SECONDS }).catch(() => undefined);
            }
            await kv.set(`${AUDIT_PREFIX}${now}`, { ts: now, from: playerName, to: toSlug, currency, debit: out.body.debit, credit: out.body.credit, burned: out.body.burned }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            // Economy telemetry — the 10% trade burn is a real "currency destroyed"
            // signal (sink), logged as a negative delta.
            const burned = Number((out.body as { burned?: number }).burned) || 0;
            if (burned > 0) await recordEconomyTxn({ txnId: `trade-burn:${now}`, player: playerName, currency, delta: -burned, source: 'trade.burn' });
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[player/trade]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
