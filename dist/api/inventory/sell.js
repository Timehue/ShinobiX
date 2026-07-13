"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _economy_js_1 = require("../_economy.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _settlement_receipts_js_1 = require("../_settlement-receipts.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _catalog_js_1 = require("../shop/_catalog.js");
const _sale_js_1 = require("./_sale.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const requestId = (0, _settlement_receipts_js_1.parseSettlementRequestId)(body.requestId);
        const itemId = typeof body.itemId === 'string' ? body.itemId : '';
        const source = body.source;
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        if (!requestId)
            return res.status(400).json({ error: 'Invalid settlement request ID.' });
        if (!itemId || (source !== 'backpack' && source !== 'equipped'))
            return res.status(400).json({ error: 'Invalid sale request.' });
        const identityName = await (0, _auth_js_1.authedPlayer)(req, playerName);
        if (!identityName)
            return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName)
            return res.status(403).json({ error: 'You can only sell your own items.' });
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'inventory-sale', 30, 60_000, identityName, { strict: true })))
            return;
        const catalogs = await (0, _catalog_js_1.loadSettlementCatalogs)();
        const item = catalogs.items.get(itemId);
        if (!item)
            return res.status(400).json({ error: 'Unknown sale item.' });
        const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const settled = (0, _sale_js_1.applyInventorySale)(character, item, source, Number(body.quantity), typeof body.equipmentSlot === 'string' ? body.equipmentSlot : undefined, requestId, Date.now());
            if (!settled.ok)
                return settled;
            return { ok: true, character: settled.character, value: { ...settled.value, replayed: settled.replayed } };
        });
        if (!out.ok)
            return res.status(out.status).json({ error: out.error });
        if (!out.value.replayed && out.value.ryo > 0) {
            await (0, _economy_js_1.recordEconomyTxn)({
                txnId: `inventory-sale:${playerName}:${requestId}`,
                player: playerName,
                currency: 'ryo',
                delta: out.value.ryo,
                source: 'inventory.sale',
                balanceAfter: Number(out.character.ryo ?? 0),
            });
        }
        return res.status(200).json({ ok: true, settlement: out.value, character: out.character, _saveVersion: out._saveVersion });
    }
    catch (error) {
        console.error('[inventory/sell]', error);
        return res.status(503).json({ error: 'Could not sell the item. Nothing was changed; please retry.' });
    }
}
