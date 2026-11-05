import { safeLogValue } from '../_safe-log.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { inspectSettlementReceipt, parseSettlementRequestId } from '../_settlement-receipts.js';
import { runSaveDebitSaga, saveDebitFingerprint, saveDebitTransactionId, SaveDebitRefusal } from '../_save-debit-saga.js';
import { HOLLOW_GATE_UNLOCK_SAGA, type HollowGateUnlockPlan } from '../_save-debit-kinds.js';
import { economyTxKey, type EconomyTxRecord } from '../_economy-tx.js';
import { invalidateProcCache } from '../_proc-cache.js';

const COST = 10_000;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const slug = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your village action.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-unlock', 5, 60_000, identity.name))) return;
        const requestId = parseSettlementRequestId(body.requestId);
        if (body.requestId !== undefined && !requestId) return res.status(400).json({ error: 'Invalid unlock request id.' });
        const saveKey = `save:${playerName}`;
        const existing = await kv.get<Record<string, unknown>>(saveKey);
        const existingChar = existing?.character as Record<string, unknown> | undefined;
        if (!existingChar) return res.status(404).json({ error: 'Player save not found.' });
        const village = slug(existingChar.village);
        const stateKey = `game:village-state:${village}`;
        const kageKey = `village:kage:${String(existingChar.village ?? '').toLowerCase().replace(/\s+/g, '-')}`;
        // Retain the old namespace so a retry crossing this release recovers
        // its personal payment rather than buying a second extension.
        const transactionId = saveDebitTransactionId(HOLLOW_GATE_UNLOCK_SAGA.kind, playerName, requestId);
        const fingerprint = saveDebitFingerprint(HOLLOW_GATE_UNLOCK_SAGA.kind, playerName, { village });
        const journalKey = economyTxKey(transactionId);
        const outcome = await withKvLock(kageKey, () => withKvLock(stateKey, async () => {
            for (let attempt = 0; attempt < 3; attempt++) {
                const [save, rawState, kage, journal] = await Promise.all([
                    kv.get<Record<string, unknown>>(saveKey), kv.get<Record<string, unknown>>(stateKey),
                    kv.get<{ seatedKage?: string }>(kageKey), kv.get<EconomyTxRecord>(journalKey),
                ]);
                const character = save?.character as Record<string, unknown> | undefined;
                if (!character) throw new SaveDebitRefusal(404, 'Player save not found.');
                if (slug(character.village) !== village) throw new SaveDebitRefusal(409, 'Your village changed. Refresh Town Hall.');
                const state = rawState ?? {};
                const treasury = (state.treasury ?? {}) as Record<string, unknown>;
                const seals = Number(treasury.honorSeals ?? 0);
                const reply = (until: number, replayed: boolean) => ({
                    ok: true, character, _saveVersion: Number(save?._saveVersion ?? 0),
                    hollowGateUnlockedUntil: until, treasuryHonorSeals: seals, cost: COST,
                    ...(replayed ? { replayed: true } : {}),
                });
                // Only existing personal debits may use the old saga. Its
                // decision refuses NEW wallet charges; recovery and admin
                // reconciliation keep their existing credit definition.
                const oldReceipt = inspectSettlementReceipt(character, transactionId, fingerprint);
                if ((journal && journal.meta?.funding !== 'treasury') || (!journal && oldReceipt.status === 'replay')) {
                    const legacy = await runSaveDebitSaga<Record<string, unknown>, HollowGateUnlockPlan, { cost: number }>({
                        definition: HOLLOW_GATE_UNLOCK_SAGA, playerName, requestId, identity: { village },
                        sharedKey: stateKey, resource: 'honorSeals', amount: COST,
                        decide: () => ({ ok: false, status: 409, error: 'The earlier personal payment did not complete. Refresh and start a new treasury purchase.' }),
                    });
                    return { ...reply(Number(legacy.shared.hollowGateUnlockedUntil) || 0, true),
                        character: legacy.character, _saveVersion: legacy._saveVersion };
                }
                if (!identity.admin && safeName(String(kage?.seatedKage ?? '')) !== playerName)
                    throw new SaveDebitRefusal(403, 'Only the seated Kage can open the Hollow Gate.');
                if (journal) {
                    if (journal.state !== 'complete' || journal.meta?.fingerprint !== fingerprint
                        || journal.debitKey !== stateKey || journal.meta?.playerName !== playerName)
                        throw new SaveDebitRefusal(409, 'This request belongs to a different Hollow Gate payment.');
                    return reply(Number(state.hollowGateUnlockedUntil) || 0, true);
                }
                if (oldReceipt.status !== 'fresh')
                    throw new SaveDebitRefusal(409, 'Stored payment receipts need review. Contact support.');
                if (!Number.isSafeInteger(seals) || seals < COST)
                    throw new SaveDebitRefusal(409, 'The village treasury needs 10,000 Honor Seals to open the Hollow Gate.');
                const now = Date.now();
                const until = Math.max(now, Math.max(0, Number(state.hollowGateUnlockedUntil) || 0)) + WINDOW_MS;
                const next = { ...state, treasury: { ...treasury, honorSeals: seals - COST }, hollowGateUnlockedUntil: until };
                const receipt: EconomyTxRecord = {
                    id: transactionId, kind: HOLLOW_GATE_UNLOCK_SAGA.kind, state: 'complete',
                    debitKey: stateKey, creditKey: stateKey, resource: 'honorSeals', amount: COST,
                    createdAt: now, updatedAt: now, completedAt: now,
                    meta: { funding: 'treasury', playerName, village, requestId, fingerprint, hollowGateUnlockedUntil: until },
                };
                if (!kv.compareSetMany) throw new SaveDebitRefusal(503, 'Treasury payment is unavailable. Retry the same request.', { retryable: true });
                // Debit, window and durable receipt commit together. Assertions
                // bind current authorization; CAS also protects against writers
                // that missed our shared lock. No player save is written.
                try {
                    if (!(await kv.compareSetMany([
                        { op: 'cas', key: stateKey, expected: rawState, value: next },
                        { op: 'cas', key: journalKey, expected: null, value: receipt },
                        { op: 'assert', key: kageKey, expected: kage },
                        { op: 'assert', key: saveKey, expected: save },
                    ]))) continue;
                } catch (error) {
                    // A lost acknowledgement may follow a successful commit.
                    // The journal proves the whole transaction landed.
                    const recovered = await kv.get<EconomyTxRecord>(journalKey);
                    if (recovered?.state !== 'complete' || recovered.meta?.fingerprint !== fingerprint
                        || recovered.meta?.funding !== 'treasury') throw error;
                    invalidateProcCache('game-state:frame');
                    continue;
                }
                invalidateProcCache('game-state:frame');
                return { ...reply(until, false), treasuryHonorSeals: seals - COST };
            }
            throw new SaveDebitRefusal(503, 'Town Hall changed during payment. Retry the same request.', { retryable: true });
        }, { failClosed: true }), { failClosed: true });
        return res.status(200).json(outcome);
    } catch (error) {
        if (error instanceof SaveDebitRefusal) return res.status(error.status).json({ ...error.details, error: error.message });
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Town Hall is busy. Retry the same request.', retryable: true });
        console.error('[village/hollow-gate-unlock]', safeLogValue(error));
        return res.status(503).json({ error: 'The Hollow Gate payment could not be confirmed. Retry the same request; you will not be charged twice.', retryable: true });
    }
}
