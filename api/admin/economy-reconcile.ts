import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { cors, mergePreservingImages } from '../_utils.js';
import { completeEconomyTx, economyTxKey, type EconomyTxRecord } from '../_economy-tx.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { resumeSaveDebitSaga, SaveDebitRefusal } from '../_save-debit-saga.js';
import { SAVE_DEBIT_SAGAS } from '../_save-debit-kinds.js';
import { BOUNTY_KEY, normalizeBoard, type BountyBoard } from '../pvp/_bounty.js';
import { sweepPendingBountyClaims } from '../pvp/_bounty-claim.js';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/*
 * /api/admin/economy-reconcile - POST
 *
 * Admin-only one-shot reconciliation for known economy transactions that failed
 * after the debit side landed. Supports:
 *   - { txId } for a retry-safe save->shared settlement (api/_save-debit-saga.ts:
 *     shrine offerings, bounty placements, clan and village treasury
 *     donations). It runs the same idempotent credit step the player's own
 *     retry would, so it can never credit twice; an unprovable one is reported,
 *     not guessed. Find ids under `economyTx.stuck` in GET /api/admin/economy.
 *   - { txId } for clan territory War Supply collection records and the two
 *     Honor Seal refunds (`state: needs-reconcile`).
 *   - { bountyClaims: true } to finish every bounty payout left pending on the
 *     board (api/pvp/_bounty-claim.ts), each exactly once.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-economy-reconcile', 30, 60_000)) return;

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        if (body.bountyClaims === true) {
            const result = await withKvLock(BOUNTY_KEY, async () => {
                const board = normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY));
                const before = (board.pendingClaims ?? []).map((p) => p.id);
                const swept = await sweepPendingBountyClaims(board, Date.now());
                if (swept !== board) await kv.set(BOUNTY_KEY, swept);
                const remaining = (swept.pendingClaims ?? []).map((p) => p.id);
                return { finished: before.filter((id) => !remaining.includes(id)), remaining };
            }, { failClosed: true });
            console.log('[admin/economy-reconcile] bounty claims swept', JSON.stringify(result));
            return res.status(200).json({ ok: true, ...result });
        }
        const txId = typeof body.txId === 'string' ? body.txId.trim().slice(0, 180) : '';
        if (!txId) return res.status(400).json({ error: 'Missing txId.' });

        const sagaTx = await kv.get<EconomyTxRecord>(economyTxKey(txId));
        if (sagaTx && SAVE_DEBIT_SAGAS[sagaTx.kind] && typeof sagaTx.meta?.fingerprint === 'string') {
            const outcome = await resumeSaveDebitSaga(txId, SAVE_DEBIT_SAGAS);
            console.log('[admin/economy-reconcile] save-debit settlement', txId, outcome.status);
            if (outcome.status === 'unprovable') return res.status(409).json({ error: outcome.reason, ...outcome });
            return res.status(200).json({ ok: true, ...outcome });
        }

        const result = await withKvLock(economyTxKey(txId), async () => {
            const tx = await kv.get<EconomyTxRecord>(economyTxKey(txId));
            if (!tx) return { status: 404, body: { error: 'Economy transaction not found.' } };
            if (tx.state === 'complete') return { status: 200, body: { ok: true, tx, alreadyComplete: true } };
            if (tx.state !== 'needs-reconcile') return { status: 409, body: { error: `Transaction is ${tx.state}, not needs-reconcile.` } };
            const amount = Math.max(0, Math.floor(Number(tx.amount) || 0));
            if (amount <= 0) return { status: 400, body: { error: 'Transaction has no amount to reconcile.' } };

            const isHonorSealRefund = tx.resource === 'honorSeals'
                && (tx.kind === 'hollow-gate-unlock' || tx.kind === 'kage-challenge-declare');
            if (isHonorSealRefund) {
                const saveKey = String(tx.debitKey ?? '');
                if (!saveKey.startsWith('save:')) return { status: 400, body: { error: 'Transaction has no valid player save key.' } };
                let character: Record<string, unknown> | null = null;
                await withKvLock(saveKey, async () => {
                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    const current = (record?.character ?? null) as Record<string, unknown> | null;
                    if (!record || !current) throw new Error('Player save not found.');
                    character = { ...current, honorSeals: Math.max(0, num(current.honorSeals)) + amount };
                    const updated = bumpSaveVersion({ ...record, character }, { previousCharacter: current });
                    await kv.set(saveKey, mergePreservingImages(updated, record));
                }, { failClosed: true });
                const completed = await completeEconomyTx(tx.id, {
                    note: 'Admin reconciled failed cross-record Honor Seal refund.',
                    meta: { ...(tx.meta ?? {}), reconciledAt: Date.now(), reconciledBy: 'admin' },
                });
                return { status: 200, body: { ok: true, tx: completed, credited: amount, character } };
            }
            if (tx.kind !== 'clan-territory-collect-supply' || tx.resource !== 'warSupply') {
                return { status: 400, body: { error: 'This transaction type cannot be reconciled automatically.' } };
            }
            const creditKey = String(tx.creditKey ?? '');
            if (!creditKey) return { status: 400, body: { error: 'Transaction has no credit key.' } };

            let treasury: Record<string, unknown> | null = null;
            await withKvLock(creditKey, async () => {
                const clan = await kv.get<Record<string, unknown>>(creditKey);
                if (!clan) throw new Error('Clan record not found.');
                const prevTreasury = (clan.treasury ?? {}) as Record<string, unknown>;
                treasury = { ...prevTreasury, warSupply: Math.max(0, num(prevTreasury.warSupply)) + amount };
                await kv.set(creditKey, { ...clan, treasury });
            }, { failClosed: true });

            const completed = await completeEconomyTx(tx.id, {
                note: 'Admin reconciled clan territory War Supply credit.',
                meta: { ...(tx.meta ?? {}), reconciledAt: Date.now(), reconciledBy: 'admin' },
            });
            return { status: 200, body: { ok: true, tx: completed, credited: amount, treasury } };
        }, { failClosed: true });

        return res.status(result.status).json(result.body);
    } catch (err) {
        if (err instanceof SaveDebitRefusal) return res.status(err.status).json({ ...err.details, error: err.message });
        console.error('[admin/economy-reconcile]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
