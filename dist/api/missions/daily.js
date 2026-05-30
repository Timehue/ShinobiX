"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _progress_js_1 = require("./_progress.js");
const VALID_PROFESSIONS = ['healer', 'vanguard', 'petTamer'];
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const playerName = (0, _utils_js_1.safeName)(String(req.query.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only fetch your own missions.' });
        }
        const record = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = record?.character;
        const profession = char?.profession;
        if (!profession || !VALID_PROFESSIONS.includes(profession)) {
            return res.status(200).json({ profession: null, missions: [] });
        }
        const state = await (0, _progress_js_1.loadOrIssueDailyMissions)(playerName, profession);
        if (!state) {
            return res.status(200).json({ profession, missions: [] });
        }
        return res.status(200).json({
            profession: state.profession,
            date: state.date,
            missions: state.missions,
        });
    }
    catch (err) {
        console.error('[missions/daily]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
