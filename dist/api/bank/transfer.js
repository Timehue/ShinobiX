"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _wallet_transfer_js_1 = require("./_wallet-transfer.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const direction = String(body.direction ?? '');
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (direction !== 'deposit' && direction !== 'withdraw')
            return res.status(400).json({ error: 'Invalid transfer direction.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only transfer your own ryo.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'bank-transfer', 30, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const moved = (0, _wallet_transfer_js_1.transferBankRyo)(character, direction, body.amount);
            if (!moved.ok)
                return { ok: false, status: 400, error: moved.error };
            return {
                ok: true,
                character: moved.character,
                value: { walletRyo: moved.walletRyo, bankRyo: moved.bankRyo, amount: moved.amount, direction },
            };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (err) {
        console.error('[bank/transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
