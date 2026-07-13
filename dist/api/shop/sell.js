"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _sale_js_1 = require("./_sale.js");
const cleanId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(v) ? v : '';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const requestId = cleanId(body.requestId);
        if (!playerName || !requestId)
            return res.status(400).json({ error: 'Invalid sale request.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your sale.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'shop-sell', 60, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedShopSales) ? character.redeemedShopSales : [];
            const prior = receipts.find((entry) => entry?.id === requestId);
            if (prior)
                return { ok: true, character, value: { sale: prior.sale, replayed: true } };
            const sold = (0, _sale_js_1.sellCatalogItem)(character, body.itemId, body.qty, body.equipmentSlot);
            if (!sold.ok)
                return { ok: false, status: 409, error: sold.reason };
            const receipt = { id: requestId, sale: sold.sale, at: Date.now() };
            return { ok: true, character: { ...sold.character, redeemedShopSales: [...receipts.slice(-99), receipt] }, value: { sale: sold.sale, replayed: false } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[shop/sell]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
