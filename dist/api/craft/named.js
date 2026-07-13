"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _text_moderation_js_1 = require("../_text-moderation.js");
const _named_js_1 = require("./_named.js");
const cleanToken = (v) => typeof v === 'string' && /^[A-Za-z0-9]{16,96}$/.test(v) ? v : '';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        if (!playerName || !['roll', 'forge'].includes(action))
            return res.status(400).json({ error: 'Invalid named-forge request.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your forge.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'craft-named', 60, 60_000, identity.name)))
            return;
        if (action === 'roll') {
            const kind = body.kind === 'armor' ? 'armor' : 'weapon';
            const roll = (0, _named_js_1.rollNamedForge)(kind, body.slot);
            const token = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
            await _storage_js_1.kv.set(`named-forge:${playerName}:${token}`, { playerName, roll }, { ex: 20 * 60 });
            return res.status(200).json({ ok: true, token, roll });
        }
        const token = cleanToken(body.token);
        if (!token)
            return res.status(400).json({ error: 'Invalid forge token.' });
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character, record }) => {
            const receipts = Array.isArray(character.redeemedNamedForges) ? character.redeemedNamedForges : [];
            if (receipts.includes(token))
                return { ok: true, character, value: { replayed: true, item: null } };
            const sealed = await _storage_js_1.kv.get(`named-forge:${playerName}:${token}`);
            if (!sealed || sealed.playerName !== playerName)
                return { ok: false, status: 409, error: 'invalid-or-spent-roll' };
            const paid = (0, _named_js_1.debitNamedForge)(character);
            if (!paid)
                return { ok: false, status: 409, error: 'insufficient-forge-materials' };
            const item = (0, _named_js_1.buildNamedItem)(sealed.roll, (0, _text_moderation_js_1.sanitizeUserText)(body.name, 60), (0, _text_moderation_js_1.sanitizeUserText)(body.flavorText, 300));
            const inventory = Array.isArray(paid.inventory) ? paid.inventory : [];
            const creatorItems = Array.isArray(record.creatorItems) ? record.creatorItems : [];
            return { ok: true, character: { ...paid, inventory: [...inventory, item.id], redeemedNamedForges: [...receipts.slice(-49), token] }, recordPatch: { creatorItems: [...creatorItems.slice(-199), item] }, value: { replayed: false, item } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        await _storage_js_1.kv.del(`named-forge:${playerName}:${token}`).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[craft/named]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
