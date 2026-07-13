"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _pass_js_1 = require("./_pass.js");
const villageSlug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
            return res.status(400).json({ error: 'Invalid player.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your rank exam.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'rank-exam-pass', 10, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
            const state = await _storage_js_1.kv.get(`game:village-state:${villageSlug(character.village)}`);
            const appointees = Array.isArray(state?.anbuAppointees) ? state.anbuAppointees.map((name) => (0, _utils_js_1.safeName)(String(name))) : [];
            const passed = (0, _pass_js_1.passRankExam)(character, body.examKey, { isKage: (0, _utils_js_1.safeName)(state?.seatedKage ?? '') === playerName, isElder: appointees.includes(playerName) });
            if (!passed.ok)
                return { ok: false, status: 409, error: passed.reason };
            return { ok: true, character: passed.character, value: { alreadyPassed: passed.alreadyPassed } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[exams/pass]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
