"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _utils_js_1 = require("../_utils.js");
const _economy_tx_js_1 = require("../_economy-tx.js");
const _save_version_js_1 = require("../save/_save-version.js");
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
/*
 * /api/admin/economy-reconcile - POST
 *
 * Admin-only one-shot reconciliation for known economy transactions that failed
 * after the debit side landed. Currently supports clan territory War Supply
 * collection records (`state: needs-reconcile`).
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isFullAdmin)(req))
        return res.status(403).json({ error: 'Full admin access required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-economy-reconcile', 30, 60_000))
        return;
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const txId = typeof body.txId === 'string' ? body.txId.trim().slice(0, 180) : '';
        if (!txId)
            return res.status(400).json({ error: 'Missing txId.' });
        const result = await (0, _lock_js_1.withKvLock)((0, _economy_tx_js_1.economyTxKey)(txId), async () => {
            const tx = await _storage_js_1.kv.get((0, _economy_tx_js_1.economyTxKey)(txId));
            if (!tx)
                return { status: 404, body: { error: 'Economy transaction not found.' } };
            if (tx.state === 'complete')
                return { status: 200, body: { ok: true, tx, alreadyComplete: true } };
            if (tx.state !== 'needs-reconcile')
                return { status: 409, body: { error: `Transaction is ${tx.state}, not needs-reconcile.` } };
            const amount = Math.max(0, Math.floor(Number(tx.amount) || 0));
            if (amount <= 0)
                return { status: 400, body: { error: 'Transaction has no amount to reconcile.' } };
            const isHonorSealRefund = tx.resource === 'honorSeals'
                && (tx.kind === 'hollow-gate-unlock' || tx.kind === 'kage-challenge-declare');
            if (isHonorSealRefund) {
                const saveKey = String(tx.debitKey ?? '');
                if (!saveKey.startsWith('save:'))
                    return { status: 400, body: { error: 'Transaction has no valid player save key.' } };
                let character = null;
                await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                    const record = await _storage_js_1.kv.get(saveKey);
                    const current = (record?.character ?? null);
                    if (!record || !current)
                        throw new Error('Player save not found.');
                    character = { ...current, honorSeals: Math.max(0, num(current.honorSeals)) + amount };
                    const updated = (0, _save_version_js_1.bumpSaveVersion)({ ...record, character });
                    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
                }, { failClosed: true });
                const completed = await (0, _economy_tx_js_1.completeEconomyTx)(tx.id, {
                    note: 'Admin reconciled failed cross-record Honor Seal refund.',
                    meta: { ...(tx.meta ?? {}), reconciledAt: Date.now(), reconciledBy: 'admin' },
                });
                return { status: 200, body: { ok: true, tx: completed, credited: amount, character } };
            }
            if (tx.kind !== 'clan-territory-collect-supply' || tx.resource !== 'warSupply') {
                return { status: 400, body: { error: 'This transaction type cannot be reconciled automatically.' } };
            }
            const creditKey = String(tx.creditKey ?? '');
            if (!creditKey)
                return { status: 400, body: { error: 'Transaction has no credit key.' } };
            let treasury = null;
            await (0, _lock_js_1.withKvLock)(creditKey, async () => {
                const clan = await _storage_js_1.kv.get(creditKey);
                if (!clan)
                    throw new Error('Clan record not found.');
                const prevTreasury = (clan.treasury ?? {});
                treasury = { ...prevTreasury, warSupply: Math.max(0, num(prevTreasury.warSupply)) + amount };
                await _storage_js_1.kv.set(creditKey, { ...clan, treasury });
            }, { failClosed: true });
            const completed = await (0, _economy_tx_js_1.completeEconomyTx)(tx.id, {
                note: 'Admin reconciled clan territory War Supply credit.',
                meta: { ...(tx.meta ?? {}), reconciledAt: Date.now(), reconciledBy: 'admin' },
            });
            return { status: 200, body: { ok: true, tx: completed, credited: amount, treasury } };
        }, { failClosed: true });
        return res.status(result.status).json(result.body);
    }
    catch (err) {
        console.error('[admin/economy-reconcile]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
