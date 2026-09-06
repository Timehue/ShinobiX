import { safeLogValue } from '../_safe-log.js';
import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { planTrade, isTradeCurrency } from './_trade-core.js';
import { recordEconomyTxn } from '../_economy.js';
import { makeEconomyTxId, reserveEconomyTx, markEconomyTx, completeEconomyTx, failEconomyTx } from '../_economy-tx.js';

/*
 * /api/player/trade — POST (direct player-to-player transfer)
 *
 * One-way taxed SEND. The sender is debited the full amount; the recipient
 * receives amount minus a burned tax (the economy sink). Server-authoritative:
 * balances are read fresh under BOTH save locks (sorted order → no deadlock,
 * both failClosed → currency safety), the split is recomputed from _trade-core,
 * and neither side's amount comes from the client body.
 *
 *   POST { playerName, toPlayer, currency, amount, nonce? }
 *     → { ok, currency, debit, credit, burned, toPlayer }
 *
 * Money safety:
 *   - only ryo / fateShards / boneCharms / auraStones are tradeable (honor seals
 *     are Vanguard-locked, mythic seals are top-rarity — both excluded).
 *   - VOID when sender + recipient share an IP/device (no funnelling to an alt).
 *   - optional client `nonce` makes a retried request idempotent (NX receipt).
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

        const toRaw = typeof body.toPlayer === 'string' ? body.toPlayer.trim() : '';
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
        const nonceKey = nonce ? `trade:nonce:${playerName}:${nonce}` : '';
        const fingerprint = tradeNonceFingerprint(toSlug, currency, amount);
        // Fast path only. The authoritative check is repeated UNDER both save
        // locks below: this one runs before the locks, so two concurrent
        // attempts of the same nonce could both pass it. A legacy client that
        // sends no nonce keeps working, with no replay identity (its own retry
        // path is a fresh transfer — the client wrapper now keeps the nonce).
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
        // Lock BOTH saves in a stable (sorted) order so concurrent autosaves /
        // other transfers can't clobber the read-modify-write and two trades in
        // opposite directions can't deadlock.
        const senderKey = `save:${playerName}`;
        const recipientKey = `save:${toSlug}`;
        const [k1, k2] = [senderKey, recipientKey].sort();

        const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(k1, async () =>
            withKvLock<{ status: number; body: Record<string, unknown> }>(k2, async () => {
                const senderRec = await kv.get<Record<string, unknown>>(senderKey);
                const senderChar = (senderRec?.character ?? null) as Record<string, unknown> | null;
                if (!senderRec || !senderChar) return { status: 404, body: { error: 'Your save was not found.' } };
                const recipientRec = await kv.get<Record<string, unknown>>(recipientKey);
                const recipientChar = (recipientRec?.character ?? null) as Record<string, unknown> | null;
                if (!recipientRec || !recipientChar) return { status: 404, body: { error: 'That player was not found.' } };

                const plan = planTrade(currency, amount, num(senderChar[currency]));
                if (!plan.ok) return { status: 400, body: { error: plan.reason } };

                // The nonce is re-checked HERE, under the serialization
                // boundary. Two attempts of the same nonce that both passed the
                // pre-lock check are now serialized by the save locks: the
                // second one sees the first one's pending marker or receipt.
                if (nonceKey) {
                    const answer = priorNonceAnswer(await kv.get<NonceRecord>(nonceKey), fingerprint);
                    if (answer) return answer;
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
                            return { status: 503, body: { error: 'The transfer could not start. Nothing was sent.', retryable: true } };
                        }
                    }
                    if (claimed !== 'OK') {
                        // Another attempt of this exact nonce won the claim. Nothing
                        // moved here; answer from the winner's record.
                        await failEconomyTx(txId, new Error('nonce-already-claimed'), { note: 'duplicate attempt lost the nonce claim; no funds moved' }).catch(() => undefined);
                        const winner = await kv.get<NonceRecord>(nonceKey).catch(() => null);
                        return priorNonceAnswer(winner, fingerprint) ?? { status: 409, body: { error: PENDING_TRANSFER_ERROR, pending: true } };
                    }
                }

                const senderBalance = num(senderChar[currency]) - plan.debit;
                try {
                    const senderUpdated = bumpSaveVersion({ ...senderRec, character: { ...senderChar, [currency]: senderBalance } });
                    await kv.set(senderKey, mergePreservingImages(senderUpdated, senderRec));
                } catch (err) {
                    // Nothing moved. Roll the pending marker back so a retry may
                    // run for real, and journal the failure.
                    if (nonceKey) await kv.del(nonceKey).catch(() => undefined);
                    await failEconomyTx(txId, err, { note: 'debit write failed; no funds moved' }).catch(() => undefined);
                    return { status: 502, body: { error: 'The transfer could not start. Nothing was sent.' } };
                }
                await markEconomyTx(txId, 'debit-applied').catch(() => undefined);
                try {
                    const recipientUpdated = bumpSaveVersion({ ...recipientRec, character: { ...recipientChar, [currency]: num(recipientChar[currency]) + plan.credit } });
                    await kv.set(recipientKey, mergePreservingImages(recipientUpdated, recipientRec));
                } catch (err) {
                    // Debit committed, credit did not: loss-direction, never a
                    // mint. Keep the pending nonce (blocks a re-debit) and flag
                    // the journal for reconciliation.
                    await failEconomyTx(txId, err, { note: `debited ${plan.debit} ${currency}; recipient credit failed — reconcile` }).catch(() => undefined);
                    console.error('[player/trade] credit write failed after debit', safeLogValue({ txId, from: playerName, to: toSlug, currency, debit: plan.debit }));
                    return { status: 502, body: { error: 'The transfer was interrupted after the debit. It is recorded for restoration — do not resend.', txId } };
                }
                await completeEconomyTx(txId).catch(() => undefined);
                return { status: 200, body: { ok: true, currency, debit: plan.debit, credit: plan.credit, burned: plan.burned, toPlayer: toDisplay, senderBalance } };
            }, { failClosed: true }),
        { failClosed: true });

        if (out.status === 200) {
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
