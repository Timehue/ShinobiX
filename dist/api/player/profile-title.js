"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _text_moderation_js_1 = require("../_text-moderation.js");
const _titles_registry_js_1 = require("../_titles-registry.js");
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
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only edit your own profile.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'profile-title', 20, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            let field = '';
            let value = '';
            let cost = 0;
            if (action === 'title') {
                field = 'customTitle';
                value = (0, _text_moderation_js_1.sanitizeUserText)(body.value, _text_moderation_js_1.TEXT_LIMITS.customTitle);
                if (!value)
                    cost = 0;
                else if ((0, _titles_registry_js_1.isKnownEarnedTitle)(value)) {
                    const legacy = character.legacy;
                    const owned = [...(Array.isArray(character.earnedTitles) ? character.earnedTitles : []), ...(Array.isArray(character.serverTitles) ? character.serverTitles : []), ...(Array.isArray(legacy?.titles) ? legacy.titles : [])];
                    if (!owned.some((title) => (0, _titles_registry_js_1.normalizeTitleKey)(title) === (0, _titles_registry_js_1.normalizeTitleKey)(value)))
                        return { ok: false, status: 403, error: 'That title has not been earned.' };
                }
                else {
                    if (!(0, _text_moderation_js_1.isAllowedCustomTitle)(value))
                        return { ok: false, status: 400, error: 'That title is not allowed.' };
                    cost = 10;
                }
            }
            else if (action === 'style') {
                field = 'customTitleStyle';
                value = String(body.value ?? '');
                if (!_titles_registry_js_1.TITLE_STYLE_IDS.has(value))
                    return { ok: false, status: 400, error: 'Invalid title style.' };
                cost = value ? 40 : 0;
            }
            else if (action === 'icon') {
                field = 'customTitleIcon';
                value = String(body.value ?? '');
                if (!_titles_registry_js_1.TITLE_ICON_SET.has(value))
                    return { ok: false, status: 400, error: 'Invalid title icon.' };
                cost = value ? 25 : 0;
            }
            else
                return { ok: false, status: 400, error: 'Invalid profile action.' };
            if (String(character[field] ?? '') === value)
                cost = 0;
            const shards = Math.max(0, Number(character.fateShards) || 0);
            if (shards < cost)
                return { ok: false, status: 409, error: `Need ${cost} Fate Shards.` };
            return { ok: true, character: { ...character, [field]: value, fateShards: shards - cost }, value: { action, cost } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[player/profile-title]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
