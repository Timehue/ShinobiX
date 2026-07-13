"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _economy_tx_js_1 = require("../_economy-tx.js");
const _lock_js_1 = require("../_lock.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _save_version_js_1 = require("../save/_save-version.js");
const COST = 10_000;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your village action.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hollow-gate-unlock', 5, 60_000, identity.name)))
            return;
        const saveKey = `save:${playerName}`;
        const existing = await _storage_js_1.kv.get(saveKey);
        const existingChar = existing?.character;
        if (!existing || !existingChar)
            return res.status(404).json({ error: 'Player save not found.' });
        const stateKey = `game:village-state:${slug(existingChar.village)}`;
        const out = await (0, _lock_js_1.withKvLock)(stateKey, async () => (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const save = await _storage_js_1.kv.get(saveKey);
            const character = save?.character;
            const state = await _storage_js_1.kv.get(stateKey) ?? {};
            if (!save || !character)
                return { ok: false, status: 404, error: 'Player save not found.' };
            if (!identity.admin && (0, _utils_js_1.safeName)(String(state.seatedKage ?? '')) !== playerName) {
                return { ok: false, status: 403, error: 'Only the seated Kage can open the Hollow Gate.' };
            }
            const seals = Math.max(0, Math.floor(Number(character.honorSeals) || 0));
            if (seals < COST)
                return { ok: false, status: 409, error: 'Insufficient Honor Seals.' };
            const until = Math.max(Date.now(), Math.max(0, Number(state.hollowGateUnlockedUntil) || 0)) + WINDOW_MS;
            const txId = (0, _economy_tx_js_1.makeEconomyTxId)('hollow-gate-unlock');
            await (0, _economy_tx_js_1.reserveEconomyTx)({
                id: txId, kind: 'hollow-gate-unlock', debitKey: saveKey, creditKey: stateKey,
                resource: 'honorSeals', amount: COST, meta: { playerName, until },
            });
            const nextSave = (0, _save_version_js_1.bumpSaveVersion)({ ...save, character: { ...character, honorSeals: seals - COST } });
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(nextSave, save));
            await (0, _economy_tx_js_1.markEconomyTx)(txId, 'debit-applied').catch(() => undefined);
            try {
                await _storage_js_1.kv.set(stateKey, { ...state, hollowGateUnlockedUntil: until });
            }
            catch (creditError) {
                try {
                    const refund = (0, _save_version_js_1.bumpSaveVersion)({ ...nextSave, character: { ...nextSave.character, honorSeals: seals } });
                    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(refund, nextSave));
                    await (0, _economy_tx_js_1.completeEconomyTx)(txId, { note: 'Village-state write failed; Honor Seals refunded.' }).catch(() => undefined);
                    return { ok: false, status: 503, error: 'The gate could not be opened, so your Honor Seals were refunded. Please retry.' };
                }
                catch (refundError) {
                    await (0, _economy_tx_js_1.failEconomyTx)(txId, refundError, { note: 'Village-state write and automatic Honor Seal refund both failed.', meta: { playerName, until, creditError: String(creditError) } }).catch(() => undefined);
                    return { ok: false, status: 503, error: 'The gate could not be opened and the refund needs administrator reconciliation. Please do not retry.' };
                }
            }
            await (0, _economy_tx_js_1.completeEconomyTx)(txId).catch(() => undefined);
            return { ok: true, character: nextSave.character, _saveVersion: Number(nextSave._saveVersion ?? 0), until };
        }, { failClosed: true }), { failClosed: true });
        if (!out.ok)
            return res.status(out.status).json({ error: out.error });
        return res.status(200).json({ ok: true, character: out.character, _saveVersion: out._saveVersion, hollowGateUnlockedUntil: out.until, cost: COST });
    }
    catch (error) {
        console.error('[village/hollow-gate-unlock]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
