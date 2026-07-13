"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _encounter_js_1 = require("./_encounter.js");
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
        const token = cleanToken(body.token);
        if (!playerName || !token)
            return res.status(400).json({ error: 'Invalid player or encounter token.' });
        const identity = playerName ? await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName) : null;
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your encounter.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-befriend', 20, 60_000, identity.name)))
            return;
        const key = `pet-encounter:${playerName}:${token}`;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
            const receipts = Array.isArray(character.redeemedPetEncounters) ? character.redeemedPetEncounters : [];
            if (receipts.includes(token))
                return { ok: true, character, value: { replayed: true, trait: null } };
            const encounter = await _storage_js_1.kv.get(key);
            if (!encounter || encounter.playerName !== playerName)
                return { ok: false, status: 409, error: 'invalid-or-spent-encounter' };
            const granted = (0, _encounter_js_1.grantWildPet)(character, encounter.pet, () => (0, node_crypto_1.randomInt)(1_000_000_000) / 1_000_000_000);
            if (!granted.ok)
                return { ok: false, status: 409, error: granted.reason };
            return { ok: true, character: { ...granted.character, redeemedPetEncounters: [...receipts.slice(-49), token] }, value: { replayed: false, trait: granted.trait } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        await _storage_js_1.kv.del(key).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[pet/befriend]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
