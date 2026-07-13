"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _auth_js_1 = require("../_auth.js");
const _economy_js_1 = require("../_economy.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _settlement_receipts_js_1 = require("../_settlement-receipts.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _catalog_js_1 = require("./_catalog.js");
const _settlement_js_1 = require("./_settlement.js");
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
        const action = body.action && typeof body.action === 'object' && !Array.isArray(body.action)
            ? body.action
            : null;
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        if (!requestId)
            return res.status(400).json({ error: 'Invalid settlement request ID.' });
        if (!action || (action.type !== 'purchase-item' && action.type !== 'open-card-pack')) {
            return res.status(400).json({ error: 'Unknown shop settlement action.' });
        }
        const identityName = await (0, _auth_js_1.authedPlayer)(req, playerName);
        if (!identityName)
            return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName)
            return res.status(403).json({ error: 'You can only use your own shop account.' });
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'shop-settlement', 30, 60_000, identityName, { strict: true })))
            return;
        const catalogs = await (0, _catalog_js_1.loadSettlementCatalogs)();
        const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            if (action.type === 'purchase-item') {
                const itemId = typeof action.itemId === 'string' ? action.itemId : '';
                const item = catalogs.items.get(itemId);
                if (!item)
                    return { ok: false, status: 400, error: 'Unknown shop item.' };
                const settled = (0, _settlement_js_1.applyItemPurchase)(character, item, Number(action.quantity), requestId, Date.now());
                if (!settled.ok)
                    return settled;
                return { ok: true, character: settled.character, value: { ...settled.value, replayed: settled.replayed } };
            }
            const packId = action.packId;
            if (packId !== 'standard' && packId !== 'epic' && packId !== 'legendary') {
                return { ok: false, status: 400, error: 'Unknown card pack.' };
            }
            const settled = (0, _settlement_js_1.applyCardPackPurchase)(character, catalogs.cards, packId, requestId, Date.now(), node_crypto_1.randomInt);
            if (!settled.ok)
                return settled;
            return { ok: true, character: settled.character, value: { ...settled.value, replayed: settled.replayed } };
        });
        if (!out.ok)
            return res.status(out.status).json({ error: out.error });
        if (!out.value.replayed && out.value.totalCost > 0) {
            await (0, _economy_js_1.recordEconomyTxn)({
                txnId: `shop:${playerName}:${requestId}`,
                player: playerName,
                currency: out.value.currency,
                delta: -out.value.totalCost,
                source: out.value.kind === 'card-pack' ? 'shop.card-pack' : 'shop.item-purchase',
                balanceAfter: Number(out.character[out.value.currency] ?? 0),
            });
        }
        return res.status(200).json({ ok: true, settlement: out.value, character: out.character, _saveVersion: out._saveVersion });
    }
    catch (error) {
        console.error('[shop/settle]', error);
        return res.status(503).json({ error: 'Could not settle the shop action. Nothing was changed; please retry.' });
    }
}
