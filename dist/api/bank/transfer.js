"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _transfer_js_1 = require("./_transfer.js");
/*
 * /api/bank/transfer - POST { playerName, action, amount }
 *
 * Moves ryo using only balances read under the fail-closed save lock. The
 * returned character is authoritative; clients must not reproduce the move
 * locally or fall back to a raw autosave.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const action = (0, _transfer_js_1.parseBankTransferAction)(body.action);
        const amount = (0, _transfer_js_1.parseBankTransferAmount)(body.amount);
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        if (!action)
            return res.status(400).json({ error: 'Action must be deposit or withdraw.' });
        if (amount === null)
            return res.status(400).json({ error: 'Amount must be a whole number from 1 to 10,000,000.' });
        const identityName = await (0, _auth_js_1.authedPlayer)(req, playerName);
        if (!identityName)
            return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName)
            return res.status(403).json({ error: 'You can only use your own bank account.' });
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'bank-transfer', 20, 60_000, identityName, { strict: true })))
            return;
        try {
            const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
                const transfer = (0, _transfer_js_1.applyBankTransfer)(character, action, amount);
                if (!transfer.ok)
                    return transfer;
                return {
                    ok: true,
                    character: transfer.character,
                    value: {
                        action: transfer.action,
                        amount: transfer.amount,
                        ryo: transfer.ryo,
                        bankRyo: transfer.bankRyo,
                    },
                };
            });
            if (!out.ok)
                return res.status(out.status).json({ error: out.error });
            return res.status(200).json({
                ok: true,
                ...out.value,
                character: out.character,
                _saveVersion: out._saveVersion,
            });
        }
        catch (err) {
            console.error('[bank/transfer] locked mutation failed', err);
            return res.status(503).json({ error: 'Could not update your bank account. Please retry.' });
        }
    }
    catch (err) {
        console.error('[bank/transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
