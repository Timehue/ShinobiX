import { safeLogValue } from '../_safe-log.js';
import { resolvePlayerReference } from '../_account-name.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { mutatePlayerSaves, PlayerSavesPartialCommitError, type PlayerSaveCommit, type PlayerSavesDecision } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import { planTrade, isTradeCurrency } from './_trade-core.js';
import { chargeOutboundBudget, checkOutboundBudget, senderTrustTier, withOutboundBudgetGate } from './_transfer-budget.js';
import { makeEconomyTxId, reserveEconomyTx, markEconomyTx, failEconomyTx, economyTxKey, type EconomyTxRecord } from '../_economy-tx.js';
import {
    closeTradeBooks,
    creditWithReceipt,
    debitWithReceipt,
    NONCE_TTL_SECONDS,
    openTradePointer,
    recordTradeCompletion,
    releaseTradeNonce,
    tradeNonceFingerprint,
    tradeNonceKey,
    tradeStage,
    tradeTermsFromJournal,
    type TradeTerms,
} from './_trade-settlement.js';

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

const PENDING_TRANSFER_ERROR = 'A previous attempt of this transfer is still settling. It was NOT sent twice — refresh your balance before retrying.';
const NEEDS_ADMIN_ERROR = 'This transfer needs an admin to finish it. It was NOT sent twice — do not resend.';
/**
 * A pending nonce younger than this may belong to an attempt that still holds
 * the budget gate and both save locks. Its retry is answered "still settling"
 * before the locks, so a double click does not queue behind it. An older one
 * belongs to an attempt that failed or died, and its retry finishes the trade.
 */
export const TRADE_IN_FLIGHT_MS = 15_000;

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

type NonceRecord = { receipt?: unknown; txId?: unknown; fp?: unknown; pending?: unknown; ts?: unknown };

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
        // BEFORE the sender debit, then upgraded to the final receipt when the
        // transfer completes. Three retry cases:
        //   • prior.receipt      → the transfer completed; replay the receipt.
        //   • prior pending only → a previous attempt debited (or was about to)
        //     and never finished. Under both save locks, that attempt is not
        //     running any more, so the retry FINISHES it from the receipts its
        //     writes left in both saves (api/player/_trade-settlement.ts): the
        //     credit rolls forward, or a debit that provably never landed runs
        //     for real. Never a second debit, never a second credit. A trade
        //     nobody retries is finished the same way by the recovery sweep.
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
        const nonceKey = nonce ? tradeNonceKey(playerName, nonce) : '';
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
            // An attempt this recent may still be running; don't queue behind
            // it. An older pending marker falls through and is finished below.
            if (prior && Date.now() - Number(prior.ts ?? 0) < TRADE_IN_FLIGHT_MS) {
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
        // What the current attempt writes, and how it ended, for the replies
        // below. A conflict retry starts a fresh attempt, so each one resets them.
        //   'both'    the debit and the credit: a new trade, or a pending one
        //             whose debit provably never landed
        //   'credit'  only the credit: a pending trade whose debit landed
        //   'none'    nothing: a pending trade whose two writes both landed
        let attempt: { txId: string; debit: number; writes: 'both' | 'credit' | 'none' } | null = null;
        let debitOutcome: 'missed' | 'unknown' | null = null;
        // Set under the locks when the trade's books close.
        let finished: { reply: TradeReply; completedNow: boolean; terms: TradeTerms } | null = null;

        // mutatePlayerSaves locks BOTH saves in one sorted order, fail-closed,
        // before reading either, so concurrent autosaves and other transfers
        // cannot clobber the read-modify-write and two trades in opposite
        // directions cannot deadlock. Each save is settled first (its idle
        // recovery included), and the writes commit sender first: debit, then
        // credit. Each write carries the trade's receipt, which is what lets a
        // retry finish an interrupted trade exactly once.
        const transfer = () => mutatePlayerSaves<TradeReply>([playerName, toSlug], async (sides) => {
            attempt = null;
            debitOutcome = null;
            finished = null;
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
            const success = (terms: TradeTerms, senderBalance: number): TradeReply => ({
                status: 200,
                body: { ok: true, currency, debit: terms.debit, credit: terms.credit, burned: terms.burned, toPlayer: toDisplay, senderBalance },
            });
            // Close the books under both locks, answering with the sender's
            // committed balance and version. A retry that found the trade
            // already complete is a replay.
            const finish = (terms: TradeTerms) => async (saves: Record<string, PlayerSaveCommit & { written: boolean }>) => {
                const senderSave = saves[playerName]!;
                const body = { ...success(terms, num(senderSave.character[currency])).body, _saveVersion: senderSave._saveVersion };
                const completedNow = await closeTradeBooks(terms, { nonceKey, fingerprint, body });
                finished = { reply: { status: 200, body: completedNow ? body : { ...body, duplicate: true } }, completedNow, terms };
            };
            // Rolling 24h SEND-side ceiling, checked under the same locks the
            // debit runs under so two concurrent transfers cannot both pass a
            // pre-lock check and jointly exceed it. The per-transfer cap alone
            // left the real ceiling at 20 calls/min x 200,000 = 4,000,000 ryo a
            // minute. Nothing is added to RECEIVING: RuneScape ran that
            // experiment in 2008 and removed it in 2011 for breaking ordinary
            // play. (MMORPG behavior audit F8.)
            const budgetRefusal = async (debit: number): Promise<Record<string, unknown> | null> => {
                if (identity.admin) return null;
                const tier = await senderTrustTier(playerName, sender.character);
                const budget = await checkOutboundBudget(playerName, currency, debit, tier);
                return budget.ok ? null : { error: budget.error, reason: 'transfer-budget', remaining: budget.remaining, limit: budget.limit };
            };

            // The debit and the credit, each with the trade's receipt.
            const writeBoth = (terms: TradeTerms, journalMeta: Record<string, unknown>): PlayerSavesDecision<TradeReply> => {
                const { txId } = terms;
                attempt = { txId, debit: terms.debit, writes: 'both' };
                let meta = { ...journalMeta };
                // Nothing moved. Roll the pending marker back so a retry may run
                // for real, and journal the failure.
                const releaseNonce = async (error: unknown, note: string) => {
                    debitOutcome = 'missed';
                    await releaseTradeNonce(nonceKey, txId).catch(() => undefined);
                    await failEconomyTx(txId, error, { note }).catch(() => undefined);
                };
                const readVersion = Number(sender.record._saveVersion ?? 0);
                return {
                    ok: true,
                    value: success(terms, num(sender.character[currency]) - terms.debit),
                    sides: {
                        [playerName]: {
                            character: debitWithReceipt(sender.character, terms, now),
                            // The debit committed: stamp it, then charge the rolling
                            // window beside it, before the credit is tried. Inside
                            // the locks, because outside them the check above is
                            // worthless: request N+1 takes the locks the moment N
                            // frees them and reads a ledger N has not written yet,
                            // so 20 pipelined calls all pass and the real ceiling
                            // stays 20 x 200,000/min — the exact number this budget
                            // exists to close. Only a committed debit is charged, so
                            // a refusal or a replay never eats budget the player did
                            // not spend, and finishing a trade never charges it twice.
                            afterCommit: async () => {
                                meta = { ...meta, debitAppliedAt: Date.now() };
                                await markEconomyTx(txId, 'debit-applied', { meta }).catch(() => undefined);
                                if (!identity.admin) await chargeOutboundBudget(playerName, currency, terms.debit, Date.now());
                            },
                        },
                        [toSlug]: {
                            character: creditWithReceipt(recipient.character, terms, now),
                            afterCommit: async () => {
                                meta = { ...meta, creditAppliedAt: Date.now() };
                                await markEconomyTx(txId, 'credit-applied', { meta }).catch(() => undefined);
                            },
                        },
                    },
                    onConflict: (error) => releaseNonce(error, 'debit lost its compare-and-set; no funds moved'),
                    // A debit can commit and still throw. Deleting the marker after
                    // one that landed let the retry of the same nonce debit the
                    // sender a second time, so only a proven miss releases it.
                    onUnconfirmedWrite: async (error) => {
                        if (await debitProvablyMissed(senderKey, readVersion)) return releaseNonce(error, 'debit write failed; no funds moved');
                        // The debit may have landed. Keep the pending marker: the
                        // next retry reads the receipts and finishes the trade.
                        debitOutcome = 'unknown';
                        await failEconomyTx(txId, error, { note: `debit of ${terms.debit} ${currency} unconfirmed; recipient not credited — a retry of the same nonce finishes it` }).catch(() => undefined);
                        console.error('[player/trade] debit write unconfirmed', safeLogValue({ txId, from: playerName, to: toSlug, currency, debit: terms.debit }));
                    },
                    afterCommit: finish(terms),
                };
            };

            // Finish a pending trade that the attempt which wrote its marker left
            // behind. No attempt holds the locks, so that one is not running.
            const resume = async (txId: string): Promise<PlayerSavesDecision<TradeReply>> => {
                const journal = txId ? await kv.get<EconomyTxRecord>(economyTxKey(txId)) : null;
                const terms = tradeTermsFromJournal(journal);
                // Only a journal written with receipts can be finished from them,
                // and it must be THIS request's trade.
                if (!journal || !terms || journal.meta?.receiptBacked !== true
                    || terms.sender !== playerName || terms.recipient !== toSlug
                    || terms.currency !== currency || terms.debit !== amount) {
                    return answer(409, { error: NEEDS_ADMIN_ERROR, pending: true, txId: txId || undefined });
                }
                const journalMeta = journal.meta ?? {};
                const stage = tradeStage(sender.character, recipient.character, terms, journal);
                if (stage.stage === 'unprovable') {
                    await failEconomyTx(txId, new Error('trade-unprovable'), { note: stage.reason }).catch(() => undefined);
                    console.error('[player/trade] pending trade needs an admin', safeLogValue({ txId, from: playerName, to: toSlug, reason: stage.reason }));
                    return answer(409, { error: NEEDS_ADMIN_ERROR, pending: true, txId });
                }
                const untouched = {
                    [playerName]: { character: sender.character, write: false },
                    [toSlug]: { character: recipient.character, write: false },
                };
                if (stage.stage === 'settled') {
                    // Both writes landed; only the books were left open.
                    attempt = { txId, debit: terms.debit, writes: 'none' };
                    return { ok: true, value: success(terms, num(sender.character[currency])), sides: untouched, afterCommit: finish(terms) };
                }
                if (stage.stage === 'debited') {
                    // The debit landed and the credit provably did not: roll the
                    // credit forward. Whatever happens to it, the marker stays.
                    attempt = { txId, debit: terms.debit, writes: 'credit' };
                    let meta = { ...journalMeta };
                    return {
                        ok: true,
                        value: success(terms, num(sender.character[currency])),
                        sides: {
                            [playerName]: { character: sender.character, write: false },
                            [toSlug]: {
                                character: creditWithReceipt(recipient.character, terms, now),
                                afterCommit: async () => {
                                    meta = { ...meta, creditAppliedAt: Date.now() };
                                    await markEconomyTx(txId, 'credit-applied', { meta }).catch(() => undefined);
                                },
                            },
                        },
                        afterCommit: finish(terms),
                    };
                }
                // Nothing moved: run it for real under the same journal entry,
                // against today's balance and budget. A refusal frees the nonce.
                const refuse = async (status: number, body: Record<string, unknown>, note: string) => {
                    await releaseTradeNonce(nonceKey, txId).catch(() => undefined);
                    await failEconomyTx(txId, new Error('trade-refused-on-retry'), { note }).catch(() => undefined);
                    return answer(status, body);
                };
                const retried = planTrade(currency, amount, num(sender.character[currency]));
                if (!retried.ok) return refuse(400, { error: retried.reason }, `retry refused (${retried.reason}); no funds moved`);
                const retryRefusal = await budgetRefusal(retried.debit);
                if (retryRefusal) return refuse(429, retryRefusal, 'retry refused by the transfer budget; no funds moved');
                return writeBoth(terms, journalMeta);
            };

            // The nonce is checked HERE, under the serialization boundary and
            // before anything else: a pending trade is finished on its own
            // terms, never refused by a balance its own debit already lowered.
            if (nonceKey) {
                const prior = await kv.get<NonceRecord>(nonceKey);
                if (prior) {
                    if (typeof prior.fp === 'string' && prior.fp !== fingerprint) {
                        return answer(409, { error: 'That request id was already used for a different transfer.', nonceConflict: true });
                    }
                    if (prior.receipt) return answer(200, { ...(prior.receipt as Record<string, unknown>), duplicate: true });
                    return resume(typeof prior.txId === 'string' ? prior.txId : '');
                }
            }

            const plan = planTrade(currency, amount, num(sender.character[currency]));
            if (!plan.ok) return answer(400, { error: plan.reason });
            const refusal = await budgetRefusal(plan.debit);
            if (refusal) return answer(429, refusal);

            // P0-2: journal the two-save settlement (reserve → debit-applied →
            // credit-applied → complete / needs-reconcile) so a failure between
            // the two writes leaves a durable trail instead of silently burning
            // the sender's funds — the pattern treasury transfers already use.
            // `receiptBacked` marks a journal whose writes carry receipts, the
            // only kind a retry or the admin reconcile can finish.
            const txId = makeEconomyTxId('player-trade');
            const journalMeta = { credit: plan.credit, burned: plan.burned, nonce: nonce || undefined, receiptBacked: true };
            // The recovery sweep finds an unfinished trade through this pointer,
            // so it goes up before anything that could leave one behind. Nothing
            // has moved yet, so a trade that cannot publish it does not start.
            try {
                await openTradePointer(txId, playerName, toSlug);
            } catch {
                return answer(503, { error: 'The transfer could not start. Nothing was sent.', retryable: true });
            }
            await reserveEconomyTx({
                id: txId, kind: 'player-trade',
                debitKey: senderKey, creditKey: recipientKey,
                resource: currency, amount: plan.debit,
                meta: journalMeta,
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
            return writeBoth(
                { txId, sender: playerName, recipient: toSlug, currency, debit: plan.debit, credit: plan.credit, burned: plan.burned },
                journalMeta,
            );
        });

        const settle = async (): Promise<TradeReply> => {
            try {
                // A lost compare-and-set moved nothing new (a fresh debit released
                // its nonce; a credit roll-forward keeps it), so the whole decision
                // may run again.
                const out = await retryOnSaveVersionConflict(transfer);
                if (!out.ok) {
                    if (out.status !== 404) return { status: out.status, body: { error: out.error } };
                    return { status: 404, body: { error: out.playerName === playerName ? 'Your save was not found.' : 'That player was not found.' } };
                }
                // A trade answers from its closed books, which carry the committed
                // version the sender's open tab adopts instead of 409ing its next
                // autosave. A refusal or a replay wrote nothing, and answers
                // exactly as it was decided.
                return finished ? finished.reply : out.value;
            } catch (err) {
                if (err instanceof PlayerSavesPartialCommitError && attempt?.writes === 'both') {
                    // Debit committed, credit did not (or cannot be shown to
                    // have): loss-direction, never a mint. Keep the pending nonce:
                    // a retry of it rolls the credit forward from the debit's
                    // receipt, and an admin reconcile can do the same.
                    const { txId, debit } = attempt;
                    await failEconomyTx(txId, err.cause, { note: `debited ${debit} ${currency}; recipient credit failed — a retry of the same nonce finishes it` }).catch(() => undefined);
                    console.error('[player/trade] credit write failed after debit', safeLogValue({ txId, from: playerName, to: toSlug, currency, debit }));
                    return { status: 502, body: { error: 'The transfer was interrupted after the debit. Retrying it finishes the transfer without charging you twice.', pending: true, txId } };
                }
                if (attempt && attempt.writes !== 'both') {
                    // Finishing a pending trade failed before its books closed.
                    // Its debit landed earlier, so nothing new was charged; the
                    // marker stays and the next retry finishes it.
                    console.error('[player/trade] finishing a pending trade failed', safeLogValue({ txId: attempt.txId, from: playerName, to: toSlug, error: err instanceof Error ? err.message : String(err) }));
                    return { status: isPlayerSaveVersionConflict(err) ? 409 : 502, body: { error: PENDING_TRANSFER_ERROR, pending: true, txId: attempt.txId } };
                }
                // Lost the compare-and-set on every try. Nothing moved, and the
                // nonce is free again.
                if (isPlayerSaveVersionConflict(err)) return { status: 409, body: { ...SAVE_VERSION_CONFLICT_REPLY } };
                if (debitOutcome === 'missed') return { status: 502, body: { error: 'The transfer could not start. Nothing was sent.' } };
                if (debitOutcome === 'unknown' && attempt) {
                    return { status: 502, body: { error: 'The transfer could not be confirmed. Retrying it finishes the transfer without charging you twice.', pending: true, txId: attempt.txId } };
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

        // Only the call that completed the trade records it. A replay, or a
        // retry that found it already complete, would count one transfer twice
        // in the economy ledger. (The final nonce receipt was written with the
        // books, under the locks, where a concurrent retry sees it.)
        const done = finished as { completedNow: boolean; terms: TradeTerms } | null;
        if (done?.completedNow) await recordTradeCompletion(done.terms);
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[player/trade]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
