import { randomUUID } from 'node:crypto';
import { safeLogValue } from '../../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { safeName, cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { LockContendedError, withKvLock } from '../../_lock.js';
import { writeVersionedPlayerSave } from '../../save/_mutate-player-save.js';
import {
    beginDurableSettlement,
    cancelDurableSettlement,
    completeDurableSettlement,
    inspectSettlementReceipt as inspectDurableReceipt,
    settlementFingerprint,
    settlementTransactionId,
    updateDurableSettlement,
} from '../../_durable-settlement.js';
import {
    appendSettlementReceipt as appendPlayerReceipt,
    inspectSettlementReceipt as inspectPlayerReceipt,
} from '../../_settlement-receipts.js';
import { loadPool, savePool } from './_storage.js';

// bumpSaveVersion is performed by writeVersionedPlayerSave below and echoed
// in the settlement result for autosave conflict recovery.

// Vanguards donate Honor Seals to their clan's pool. Per-day cumulative cap
// of 50% of (currentBalance + alreadyDonatedToday) — i.e. you can move up to
// half of what you'd have if you hadn't donated yet today. Resets at UTC
// midnight via the lazy-reset pattern on dailyDonationDate.
const DONATE_FRACTION_CAP = 0.5;
const MIN_DONATION = 1;
const MAX_DONATION_PER_CALL = 200;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function requestIdFrom(raw: unknown): string {
    const value = typeof raw === 'string' ? raw.trim() : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(value)
        ? value
        : `legacy-${randomUUID().replace(/-/g, '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const playerName = safeName(String(body.playerName ?? ''));
    const amount = Math.floor(Number(body.amount ?? 0));
    if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
    if (!Number.isFinite(amount) || amount < MIN_DONATION) {
        return res.status(400).json({ error: `Amount must be at least ${MIN_DONATION}.` });
    }
    if (amount > MAX_DONATION_PER_CALL) {
        return res.status(400).json({ error: `Max ${MAX_DONATION_PER_CALL} Seals per donation call.` });
    }

    try {
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only donate your own Seals.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-seal-donate', 20, 60_000, identity.name))) return;

        const saveKey = `save:${playerName}`;
        const requestId = requestIdFrom(body.requestId);

        // The donor row is locked before reading the clan name. The pool row
        // is then locked inside it, so concurrent donors serialize on the
        // shared pool while autosaves serialize on the donor save. A storage
        // fault or lock contention aborts before either row is changed.
        const outcome = await withKvLock(saveKey, async () => {
            const donorRecord = await kv.get<Record<string, unknown>>(saveKey);
            const donor = donorRecord?.character as Record<string, unknown> | undefined;
            if (!donorRecord || !donor) return { status: 404 as const, body: { error: 'Character not found.' } };
            if (donor.profession !== 'vanguard') {
                return { status: 403 as const, body: { error: 'Only Vanguards can donate Honor Seals.' } };
            }
            const clanName = typeof donor.clan === 'string' ? donor.clan : '';
            if (!clanName) return { status: 400 as const, body: { error: 'You must be in a clan to donate.' } };

            const poolKey = `clan-seal-pool:${clanName.toLowerCase()}`;
            return withKvLock(poolKey, async () => {
                const transactionId = settlementTransactionId('clan-seal-donate', requestId);
                const fingerprint = settlementFingerprint({
                    operation: 'clan-seal-donate',
                    playerName,
                    clanName: clanName.toLowerCase(),
                    amount,
                });
                const started = await beginDurableSettlement({
                    transactionId,
                    idempotencyKey: requestId,
                    operationType: 'clan-seal-donate',
                    fingerprint,
                    actorIds: [playerName, clanName.toLowerCase()],
                    resource: 'honorSeals',
                    amount,
                    meta: { playerName, clanName },
                }, { kv });
                if (started.status === 'conflict') {
                    return { status: 409 as const, body: { error: 'That donation request ID is already bound to a different donation.', requestId } };
                }
                if (started.record.state === 'completed' && started.record.result) {
                    return { status: 200 as const, body: { ok: true, ...started.record.result, requestId } };
                }

                const donorReceipt = inspectPlayerReceipt(donor, transactionId, fingerprint);
                if (donorReceipt.status === 'conflict' || donorReceipt.status === 'invalid') {
                    return { status: 409 as const, body: { error: 'The donor save has a conflicting or invalid settlement receipt.', requestId } };
                }

                let nextDonor = donor;
                let donorResult: Record<string, unknown>;
                if (donorReceipt.status === 'fresh') {
                    const balance = Number(donor.honorSeals ?? 0);
                    const today = utcDateKey();
                    const stampedDate = typeof donor.dailyDonationDate === 'string' ? donor.dailyDonationDate : '';
                    const donatedToday = stampedDate === today ? Number(donor.dailyDonatedSeals ?? 0) : 0;
                    const dailyCap = Math.floor((balance + donatedToday) * DONATE_FRACTION_CAP);
                    const remaining = Math.max(0, dailyCap - donatedToday);
                    if (amount > remaining) {
                        await cancelDurableSettlement(transactionId, {
                            status: 400,
                            error: 'Daily donation cap exceeded.',
                            dailyCap,
                            donatedToday,
                            remaining,
                            balance,
                        }, { kv }).catch(() => undefined);
                        return {
                            status: 400 as const,
                            body: {
                                error: `Daily donation cap is 50% of your "start of day" Seal balance. You can donate ${remaining} more today.`,
                                dailyCap, donatedToday, remaining, balance, requestId,
                            },
                        };
                    }
                    if (balance < amount) {
                        await cancelDurableSettlement(transactionId, {
                            status: 400,
                            error: 'Not enough Honor Seals.',
                            balance,
                        }, { kv }).catch(() => undefined);
                        return { status: 400 as const, body: { error: 'Not enough Honor Seals.', balance, requestId } };
                    }
                    donorResult = {
                        donated: amount,
                        honorSealsRemaining: balance - amount,
                        dailyDonatedToday: donatedToday + amount,
                        dailyCap,
                    };
                    nextDonor = appendPlayerReceipt({
                        ...donor,
                        honorSeals: balance - amount,
                        dailyDonatedSeals: donatedToday + amount,
                        dailyDonationDate: today,
                    }, donorReceipt.receipts, {
                        requestId: transactionId,
                        fingerprint,
                        value: donorResult,
                        settledAt: Date.now(),
                    });
                    const written = await writeVersionedPlayerSave(saveKey, donorRecord, nextDonor);
                    if (Number.isFinite(Number(written.record._saveVersion))) {
                        donorResult = { ...donorResult, _saveVersion: Number(written.record._saveVersion) };
                    }
                    await updateDurableSettlement(transactionId, { state: 'debit-applied' }, { kv });
                } else {
                    donorResult = {
                        ...donorReceipt.receipt.value,
                        ...(Number.isFinite(Number(donorRecord._saveVersion)) ? { _saveVersion: Number(donorRecord._saveVersion) } : {}),
                    };
                    nextDonor = { ...donor, serverSettlementReceipts: donorReceipt.receipts };
                }

                try {
                    const pool = await loadPool(clanName);
                    const poolReceipt = inspectDurableReceipt(pool as unknown as Record<string, unknown>, transactionId, fingerprint);
                    if (poolReceipt === 'conflict' || poolReceipt === 'invalid') {
                        const error = 'The clan pool has a conflicting or invalid settlement receipt.';
                        await updateDurableSettlement(transactionId, {
                            state: 'reconciliation-required',
                            failureReason: error,
                        }, { kv }).catch(() => undefined);
                        return { status: 409 as const, body: { error, requestId } };
                    }
                    let poolBalance = Number(pool.balance ?? 0);
                    if (poolReceipt === 'fresh') {
                        poolBalance += amount;
                        pool.balance = poolBalance;
                        pool.log.unshift({ kind: 'donate', by: playerName, amount, at: Date.now() });
                        pool.settlementReceipts = [{
                            transactionId,
                            fingerprint,
                            resource: 'honorSeals',
                            amount,
                            appliedAt: Date.now(),
                            value: { poolBalance },
                        }, ...(pool.settlementReceipts ?? []).filter((entry) => entry.transactionId !== transactionId)].slice(0, 100);
                        await savePool(pool);
                        await updateDurableSettlement(transactionId, { state: 'credit-applied' }, { kv });
                    }

                    const result = { ...donorResult, poolBalance, requestId };
                    await completeDurableSettlement(transactionId, result, { kv });
                    return { status: 200 as const, body: { ok: true, ...result } };
                } catch (error) {
                    await updateDurableSettlement(transactionId, {
                        state: 'reconciliation-required',
                        failureReason: error instanceof Error ? error.message : String(error),
                    }, { kv }).catch(() => undefined);
                    throw error;
                }
            }, { failClosed: true });
        }, { failClosed: true });

        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(409).json({ error: 'Donation is busy; no Seals were moved. Retry with the same requestId.' });
        }
        console.error('[clan/seal-pool/donate]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
