"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _economy_js_1 = require("../_economy.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _titles_registry_js_1 = require("../_titles-registry.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _settlement_js_1 = require("./_settlement.js");
/** Settle paid profile actions only from the stored character under its save lock. */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const action = (0, _settlement_js_1.parseProfileSettlementAction)(body.action);
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        if (!action)
            return res.status(400).json({ error: 'Unknown profile settlement action.' });
        const identityName = await (0, _auth_js_1.authedPlayer)(req, playerName);
        if (!identityName)
            return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName)
            return res.status(403).json({ error: 'You can only update your own profile.' });
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'profile-settlement', 20, 60_000, identityName, { strict: true })))
            return;
        const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const applied = (0, _settlement_js_1.applyProfileSettlement)(character, action);
            if (!applied.ok)
                return applied;
            return {
                ok: true,
                character: applied.character,
                value: { changed: applied.changed, cost: applied.cost, action: applied.action },
            };
        });
        if (!out.ok)
            return res.status(out.status).json({ error: out.error });
        if (out.value.changed && out.value.cost > 0) {
            const now = Date.now();
            await (0, _economy_js_1.recordEconomyTxn)({
                txnId: `profile-settlement:${playerName}:${out.value.action}:${now}`,
                player: playerName,
                currency: 'fateShards',
                delta: -out.value.cost,
                source: `profile.${out.value.action}`,
                balanceAfter: Number(out.character.fateShards ?? 0),
            });
            if (action.type === 'purchase-title')
                await (0, _titles_registry_js_1.appendCustomTitleLog)(playerName, String(out.character.customTitle ?? ''));
        }
        return res.status(200).json({
            ok: true,
            ...out.value,
            character: out.character,
            _saveVersion: out._saveVersion,
        });
    }
    catch (error) {
        console.error('[profile/settle]', error);
        return res.status(503).json({ error: 'Could not update your profile. Please retry.' });
    }
}
