"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const targetName = (0, _utils_js_1.safeName)(String(body.targetName ?? ''));
        if (!targetName)
            return res.status(400).json({ error: 'Invalid target name.' });
        // Heal can only be self-targeted (or admin). Stops random bots from
        // healing every hospitalized player and nullifying hospital downtime.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, targetName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== targetName) {
            return res.status(403).json({ error: 'Can only heal yourself.' });
        }
        const key = `save:${targetName}`;
        const existing = await _storage_js_1.kv.get(key);
        if (!existing)
            return res.status(404).json({ error: 'Player not found.' });
        const char = existing.character;
        if (!char?.hospitalized)
            return res.status(400).json({ error: 'Player is not hospitalized.' });
        const healed = {
            ...existing,
            character: {
                ...char,
                hp: char.maxHp,
                chakra: char.maxChakra,
                stamina: char.maxStamina,
                hospitalized: false,
            },
        };
        await _storage_js_1.kv.set(key, (0, _utils_js_1.mergePreservingImages)(healed, existing));
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[heal]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
