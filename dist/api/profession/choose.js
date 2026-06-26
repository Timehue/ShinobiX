"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const VALID_PROFESSIONS = ['healer', 'vanguard', 'petTamer'];
const PROFESSION_UNLOCK_LEVEL = 13;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const profession = String(body.profession ?? '');
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!VALID_PROFESSIONS.includes(profession)) {
            return res.status(400).json({ error: 'Invalid profession.' });
        }
        // Admin accounts can't pick a profession — the picker UI also skips
        // them, but block at the endpoint as defense-in-depth. safeName
        // upstream strips whitespace, so the canonical forms are 'admin1'
        // and 'admin2' (the prior 'admin 1' / 'admin 2' literals never
        // matched after sanitization and silently let admins through).
        const lower = playerName.toLowerCase();
        if (lower === 'admin1' || lower === 'admin2') {
            return res.status(403).json({ error: 'Admin accounts do not pick professions.' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only choose a profession for yourself.' });
        }
        const key = `save:${playerName}`;
        // Wrap the whole read-check-write in a lock — without it two concurrent
        // POSTs both read profession=undefined, both pass the "already chosen"
        // check, both write a different profession, and last-writer-wins. Also
        // serializes against any concurrent /api/save auto-save so the
        // profession flip doesn't get clobbered by a stale character body.
        const outcome = await (0, _lock_js_1.withKvLock)(key, async () => {
            const existing = await _storage_js_1.kv.get(key);
            if (!existing)
                return { status: 404, body: { error: 'Player not found.' } };
            const char = existing.character;
            if (!char)
                return { status: 404, body: { error: 'Character not found.' } };
            const level = Number(char.level ?? 0);
            if (level < PROFESSION_UNLOCK_LEVEL) {
                return { status: 403, body: { error: `Profession unlocks at Level ${PROFESSION_UNLOCK_LEVEL}.` } };
            }
            if (char.profession) {
                return { status: 409, body: { error: 'Profession already chosen and cannot be changed.', current: char.profession } };
            }
            const updated = {
                ...existing,
                character: {
                    ...char,
                    profession,
                    professionRank: 1,
                    professionXp: 0,
                    professionChosenAt: Date.now(),
                },
            };
            (0, _save_version_js_1.bumpSaveVersion)(updated);
            await _storage_js_1.kv.set(key, (0, _utils_js_1.mergePreservingImages)(updated, existing));
            return { status: 200, body: { ok: true, profession } };
        });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[profession/choose]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
