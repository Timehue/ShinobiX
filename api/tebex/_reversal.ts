/*
 * Tebex refunds and chargebacks: take back what the payment bought.
 *
 * Underscore-prefixed: shared helper, not a route. api/tebex/webhook.ts calls
 * applyTebexReversal once the signature is verified and _webhook-core.ts has
 * decided the event is a reversal.
 *
 * ── WHAT IS TAKEN BACK ────────────────────────────────────────────────────
 *  - The Shards the purchase credited. The amount is the one WE recorded in the
 *    grant's `tebex:txn:<id>` receipt, never a number from the refund payload.
 *  - The Supporter time it paid for: the save's flag is revoked for the
 *    subscription reference the payment billed (applyEntitlementToSave, the
 *    flag's only writer, which refuses to touch a flag holding a different
 *    subscription or a live admin comp). A lost chargeback also cancels the
 *    subscription at Tebex, so it cannot bill the card again; a failed cancel is
 *    parked in `tebex:orphaned-subscriptions`, where it also stops a renewal from
 *    entitling anyone.
 *
 * ── NEVER BELOW ZERO, NEVER SILENT ────────────────────────────────────────
 * The balance is debited down to zero at most. Whatever was already spent is
 * the SHORTFALL: it is recorded on the reversal row, logged at error level and
 * listed in the admin Moderation panel. What happens to an account with a
 * shortfall (a freeze, a ban, or debiting future purchases) is the owner's
 * decision and is deliberately not automated here.
 *
 * ── EXACTLY ONCE ──────────────────────────────────────────────────────────
 * `tebex:reversal:<id>` is the durable, uncapped record and the idempotency
 * key. When Shards move it commits in the SAME transaction as the save and its
 * `ledger:currency:<name>` row (mutatePlayerSave → commitPlayerSaveRecord, via
 * atomicProof), so a crash can never leave a debit without its record or a
 * record without its debit. A redelivery finds `state: 'reversed'` and changes
 * nothing. The Supporter step runs first and is idempotent, so a crash between
 * it and the debit is finished by Tebex's retry.
 *
 * A reversal that arrives before its purchase was ever credited (Tebex retries
 * a failed `payment.completed` for days) also writes the purchase's
 * `tebex:txn:` receipt, in the same transaction, so the late delivery credits
 * nothing.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { recordEconomyTxn } from '../_economy.js';
import { safeLogValue } from '../_safe-log.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { PLAYER_SAVE_VERSION_CONFLICT, retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { applyEntitlementToSave, SUBSCRIBER_TIER } from '../_subscription.js';
import { cancelOrParkSubscription } from './_cancel-subscription.js';
import { tebexKeyId, tebexTransactionKey, type ReversalDecision, type ReversalKind } from './_webhook-core.js';

export const TEBEX_REVERSAL_PREFIX = 'tebex:reversal:';

/** The durable record of one transaction's reversal (and its open dispute). */
export function tebexReversalKey(transactionId: string): string {
    return `${TEBEX_REVERSAL_PREFIX}${tebexKeyId(transactionId)}`;
}

type Reverse = Extract<ReversalDecision, { action: 'reverse' }>;

export type SupporterReversal = {
    reference: string;
    /**
     * ended ............ the save's flag held this subscription and is now off
     * not-on-save ...... the flag holds another subscription, or none: nothing to end
     * admin-comp ....... the flag is a live admin comp, which lapses on its own
     * no-save .......... the account is gone
     * reference-unknown  the payload named no subscription reference; end it by hand
     */
    outcome: 'ended' | 'not-on-save' | 'admin-comp' | 'no-save' | 'reference-unknown';
    /** Chargebacks only: the subscription was cancelled at Tebex, or parked for a human. */
    cancel?: 'cancelled' | 'parked';
};

export type TebexReversalRecord = {
    transactionId: string;
    playerName: string;
    /** dispute-open / dispute-won move no currency; reversed is final. */
    state: 'dispute-open' | 'dispute-won' | 'reversed';
    /** The event that set the current state. */
    kind: ReversalKind;
    /** Every event seen for this transaction, oldest first. */
    events: Array<{ kind: ReversalKind; at: number }>;
    /** What the purchase credited. */
    shardsGranted: number;
    /** What the reversal took back (never more than the balance held). */
    shardsDebited: number;
    /** Granted but already spent: the unpaid chargeback debt. */
    shortfall: number;
    balanceBefore?: number;
    balanceAfter?: number;
    supporter?: SupporterReversal;
    /** Why the reversal could not reach a save, when it could not. */
    note?: string;
    at: number;
    updatedAt: number;
};

/** The purchase receipt the grant wrote (webhook.ts recordTebexTransaction). */
type GrantReceipt = { playerName?: unknown; shards?: unknown; reversedBeforeGrant?: unknown };

export type ReversalReply = { status: number; body: Record<string, unknown> };

const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));

function log(level: 'log' | 'warn' | 'error', message: string, detail: Record<string, unknown>): void {
    console[level](message, safeLogValue(JSON.stringify(detail)));
}

function withEvent(previous: TebexReversalRecord | null, kind: ReversalKind, now: number): TebexReversalRecord['events'] {
    return [...(previous?.events ?? []), { kind, at: now }].slice(-10);
}

/**
 * What the purchase credited, as far as the server knows.
 *   - a receipt with an amount: that amount
 *   - a receipt written by a reversal that beat its purchase: nothing
 *   - an older receipt that stored 0 (a backfill before 2026-11): the catalogue
 *     price, which is what that grant paid from the same payload
 *   - no receipt, but the in-save list holds the id: the catalogue price
 *   - neither: nothing was ever credited
 */
function grantedShards(receipt: GrantReceipt | null, character: Record<string, unknown> | null, decision: Reverse): number {
    if (receipt) {
        if (receipt.reversedBeforeGrant === true) return 0;
        return whole(receipt.shards) || decision.catalogueShards;
    }
    const ledger = Array.isArray(character?.redeemedTebexPurchases) ? character!.redeemedTebexPurchases as unknown[] : [];
    return ledger.includes(decision.transactionId) ? decision.catalogueShards : 0;
}

/** Record an open or won dispute. Moves no currency. */
async function recordDispute(decision: Reverse, playerName: string): Promise<ReversalReply> {
    const key = tebexReversalKey(decision.transactionId);
    const now = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await kv.get<TebexReversalRecord>(key);
        if (previous?.state === 'reversed') {
            // A dispute won after the Shards were already taken back (a refund
            // and a dispute on one payment). Nothing is re-credited
            // automatically; the owner can grant them back.
            if (decision.kind === 'dispute-won') {
                log('error', '[tebex] dispute WON on an already-reversed payment — Shards were not re-credited', {
                    transactionId: decision.transactionId, playerName: previous.playerName, shardsDebited: previous.shardsDebited,
                });
            }
            return { status: 200, body: { ok: true, action: 'already-reversed' } };
        }
        if (decision.kind === 'dispute-opened' && previous) {
            return { status: 200, body: { ok: true, action: 'dispute-recorded', replay: true } };
        }
        if (decision.kind === 'dispute-won' && previous?.state === 'dispute-won') {
            return { status: 200, body: { ok: true, action: 'dispute-closed', replay: true } };
        }
        const record: TebexReversalRecord = {
            transactionId: decision.transactionId,
            playerName: previous?.playerName || playerName,
            state: decision.kind === 'dispute-won' ? 'dispute-won' : 'dispute-open',
            kind: decision.kind,
            events: withEvent(previous, decision.kind, now),
            shardsGranted: previous?.shardsGranted ?? 0,
            shardsDebited: 0,
            shortfall: 0,
            at: previous?.at ?? now,
            updatedAt: now,
        };
        if (await kv.compareSet(key, previous ?? null, record)) {
            log('warn', `[tebex] ${decision.kind === 'dispute-won' ? 'dispute won' : 'DISPUTE OPENED'}`, {
                transactionId: decision.transactionId, playerName: record.playerName,
            });
            return { status: 200, body: { ok: true, action: decision.kind === 'dispute-won' ? 'dispute-closed' : 'dispute-recorded' } };
        }
    }
    throw new Error('tebex-reversal-record-contended');
}

/** End the Supporter time this payment bought. Idempotent; runs before the debit. */
async function reverseSupporter(decision: Reverse, playerName: string): Promise<SupporterReversal | undefined> {
    if (!decision.supporter) return undefined;
    const reference = decision.subscriptionReference;
    if (!reference) {
        log('error', '[tebex] Supporter payment reversed with NO subscription reference — end the perks by hand', {
            transactionId: decision.transactionId, playerName,
        });
        return { reference: '', outcome: 'reference-unknown' };
    }
    const write = playerName
        ? await applyEntitlementToSave(playerName, reference, { active: false, tier: SUBSCRIBER_TIER, entitledCents: 0 })
        : { outcome: 'no-save' as const };
    const outcome: SupporterReversal['outcome'] = write.outcome === 'applied' ? 'ended'
        : write.outcome === 'no-save' ? 'no-save'
            : write.reason === 'admin-comp-on-save' ? 'admin-comp' : 'not-on-save';
    const supporter: SupporterReversal = { reference, outcome };
    if (decision.kind === 'chargeback') {
        // A card that charged back must not be billed again. The reference came
        // from the charged-back payment itself, so it is the payer's own
        // subscription whoever holds the name now. A refund leaves billing to
        // whoever issued it in the Tebex dashboard.
        const cancel = await cancelOrParkSubscription(playerName || 'unknown', reference, fetch, 'charged-back payment');
        supporter.cancel = cancel.ok ? 'cancelled' : 'parked';
    }
    return supporter;
}

/** Write the reversal record (and a blocking purchase receipt) without a save write. */
async function commitRecordOnly(
    reversalKey: string,
    previous: TebexReversalRecord | null,
    record: TebexReversalRecord,
    receiptOps: Array<{ op: 'cas'; key: string; expected: null; value: unknown }>,
): Promise<void> {
    const ops = [{ op: 'cas' as const, key: reversalKey, expected: previous ?? null, value: record }, ...receiptOps];
    const committed = kv.compareSetMany
        ? await kv.compareSetMany(ops)
        : (await Promise.all(ops.map((op) => kv.compareSet(op.key, op.expected, op.value)))).every(Boolean);
    // The conflict error retryOnSaveVersionConflict recognises: re-read and decide again.
    if (!committed) throw new Error(PLAYER_SAVE_VERSION_CONFLICT);
}

/**
 * Apply one verified reversal webhook. Throws on a storage failure (the caller
 * answers 500 so Tebex retries); every other outcome is a final 200.
 */
export async function applyTebexReversal(decision: Reverse): Promise<ReversalReply> {
    const txnKey = tebexTransactionKey(decision.transactionId);
    const reversalKey = tebexReversalKey(decision.transactionId);

    const receipt = await kv.get<GrantReceipt>(txnKey);
    // The name the grant actually credited wins over the payload's.
    const playerName = safeName(typeof receipt?.playerName === 'string' && receipt.playerName ? receipt.playerName : decision.playerName);

    if (decision.kind === 'dispute-opened' || decision.kind === 'dispute-won') {
        return recordDispute(decision, playerName);
    }

    const existing = await kv.get<TebexReversalRecord>(reversalKey);
    if (existing?.state === 'reversed') {
        log('log', '[tebex] reversal replay — nothing taken twice', { transactionId: decision.transactionId, kind: decision.kind });
        return { status: 200, body: { ok: true, action: 'reversed', replay: true, shardsDebited: 0, shortfall: existing.shortfall } };
    }

    const supporter = await reverseSupporter(decision, playerName);

    const build = (
        previous: TebexReversalRecord | null,
        fields: Pick<TebexReversalRecord, 'shardsGranted' | 'shardsDebited' | 'shortfall'> & Partial<TebexReversalRecord>,
    ): TebexReversalRecord => {
        const now = Date.now();
        return {
            transactionId: decision.transactionId,
            playerName,
            state: 'reversed',
            kind: decision.kind,
            events: withEvent(previous, decision.kind, now),
            ...(supporter ? { supporter } : {}),
            at: previous?.at ?? now,
            updatedAt: now,
            ...fields,
        };
    };
    // A reversal that beat its purchase blocks that purchase from ever paying.
    const blockingReceipt = (granted: number) => [{
        op: 'cas' as const, key: txnKey, expected: null,
        value: { playerName, shards: granted, at: Date.now(), reversedBeforeGrant: granted === 0, reversed: true },
    }];

    type Applied = { replay: boolean; record: TebexReversalRecord };
    const result = playerName
        ? await retryOnSaveVersionConflict(() => mutatePlayerSave<Applied>(playerName, async ({ character }) => {
            // Re-read both rows under the save lock: the grant takes the same lock.
            const [previous, currentReceipt] = await Promise.all([
                kv.get<TebexReversalRecord>(reversalKey),
                kv.get<GrantReceipt>(txnKey),
            ]);
            if (previous?.state === 'reversed') {
                return { ok: true as const, write: false, character, value: { replay: true, record: previous } };
            }
            const granted = grantedShards(currentReceipt, character, decision);
            const balanceBefore = whole(character.fateShards);
            const debit = Math.min(balanceBefore, granted);
            const record = build(previous, {
                shardsGranted: granted,
                shardsDebited: debit,
                shortfall: granted - debit,
                balanceBefore,
                balanceAfter: balanceBefore - debit,
            });
            const receiptOps = currentReceipt ? [] : blockingReceipt(granted);
            if (debit === 0) {
                // No currency moves, so the save is not rewritten (no version bump
                // for the player's open tab to trip over); the rows commit alone,
                // still under the save lock.
                await commitRecordOnly(reversalKey, previous, record, receiptOps);
                return { ok: true as const, write: false, character, value: { replay: false, record } };
            }
            return {
                ok: true as const,
                character: { ...character, fateShards: balanceBefore - debit },
                value: { replay: false, record },
                // Same transaction as the save and its currency-ledger row.
                atomicProof: { key: reversalKey, expected: previous ?? null, value: record, additionalOps: receiptOps },
            };
        }))
        : null;

    let record: TebexReversalRecord;
    let saveVersion: number | undefined;
    if (result?.ok) {
        if (result.value.replay) {
            return { status: 200, body: { ok: true, action: 'reversed', replay: true, shardsDebited: 0, shortfall: result.value.record.shortfall } };
        }
        record = result.value.record;
        saveVersion = result._saveVersion;
    } else if (!result || result.code === 'save-not-found' || result.code === 'character-not-found') {
        // No account to debit: the name was never identified, or the account is
        // gone. The whole grant is the shortfall; a retry cannot change that.
        const previous = await kv.get<TebexReversalRecord>(reversalKey);
        if (previous?.state === 'reversed') return { status: 200, body: { ok: true, action: 'reversed', replay: true, shardsDebited: 0, shortfall: previous.shortfall } };
        const granted = grantedShards(receipt, null, decision);
        record = build(previous, { shardsGranted: granted, shardsDebited: 0, shortfall: granted, note: playerName ? 'no-save' : 'no-player-identity' });
        await retryOnSaveVersionConflict(() => commitRecordOnly(reversalKey, previous, record, receipt ? [] : blockingReceipt(granted)));
    } else {
        throw new Error(`reversal save write failed: ${result.status} ${result.error}`);
    }

    if (record.shardsDebited > 0) {
        void recordEconomyTxn({
            txnId: `tebex-reversal:${decision.transactionId}`,
            player: playerName,
            currency: 'fateShards',
            delta: -record.shardsDebited,
            source: 'tebex.reversal',
            balanceAfter: record.balanceAfter,
        });
    }
    const detail = {
        transactionId: decision.transactionId, kind: decision.kind, playerName,
        shardsGranted: record.shardsGranted, shardsDebited: record.shardsDebited, shortfall: record.shortfall,
        supporter: record.supporter, note: record.note,
    };
    if (record.shortfall > 0) log('error', '[tebex] CHARGEBACK DEBT — Shards already spent; owner decision pending', detail);
    else log('warn', '[tebex] payment reversed', detail);

    return {
        status: 200,
        body: {
            ok: true,
            action: 'reversed',
            kind: decision.kind,
            shardsDebited: record.shardsDebited,
            shortfall: record.shortfall,
            ...(record.supporter ? { supporter: record.supporter.outcome } : {}),
            ...(saveVersion !== undefined ? { _saveVersion: saveVersion } : {}),
        },
    };
}

/**
 * Every recorded reversal and open dispute, newest first, for the admin
 * Moderation panel. Read-only.
 */
export async function listTebexReversals(limit = 200): Promise<TebexReversalRecord[]> {
    const keys = await kv.keys(`${TEBEX_REVERSAL_PREFIX}*`);
    if (keys.length === 0) return [];
    const rows = await kv.mget<TebexReversalRecord[]>(...keys);
    return rows
        .filter((row): row is TebexReversalRecord => Boolean(row && typeof row === 'object' && typeof row.transactionId === 'string'))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
}
