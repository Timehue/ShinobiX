"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _forge_js_1 = require("./_forge.js");
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
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only purchase your own bloodline forge.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'bloodline-forge', 6, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character, record }) => {
            const purchase = (0, _forge_js_1.applyBloodlineForgePurchase)(character, record.pendingBloodlineForges, body.rank, (0, node_crypto_1.randomUUID)(), Date.now());
            if (!purchase.ok)
                return purchase;
            return {
                ok: true,
                character: purchase.character,
                recordPatch: { pendingBloodlineForges: purchase.pending },
                value: {
                    rank: purchase.entitlement.rank,
                    currency: purchase.currency,
                    cost: purchase.cost,
                    balance: purchase.balance,
                },
            };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            ...result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    }
    catch (err) {
        console.error('[bloodlines/forge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
