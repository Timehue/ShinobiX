"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
// One-way "follow" list, stored in its OWN KV key (`friends:<slug>`) — mirrors
// the per-player `challenges:<name>` precedent — so it never round-trips or
// clobbers the ~100KB character save and is immune to the multi-tab save
// lost-update window. Online status is NOT stored here: the client joins this
// list against the player roster it already polls (which carries the online
// flag). One-way follow has no inbox / accept-decline, so no harassment surface.
//
//   GET    ?playerName=<me>             → { following: string[] }
//   POST   { playerName, targetName }   → follow   → { following }
//   DELETE { playerName, targetName }   → unfollow → { following }
const MAX_FOLLOWS = 200;
const FOLLOWS_TTL_SEC = 365 * 24 * 60 * 60;
function friendsKey(name) {
    return `friends:${(0, _utils_js_1.safeName)(name)}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const bodyObj = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const rawName = req.method === 'GET' ? req.query.playerName : bodyObj.playerName;
    const playerName = (0, _utils_js_1.safeName)(String(rawName ?? ''));
    if (!playerName)
        return res.status(400).json({ error: 'Invalid player name.' });
    // Act only as yourself (admins may act as anyone for support).
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'Can only manage your own follows.' });
    }
    const key = friendsKey(playerName);
    if (req.method === 'GET') {
        const list = await _storage_js_1.kv.get(key);
        return res.status(200).json({ following: Array.isArray(list) ? list : [] });
    }
    if (req.method === 'POST' || req.method === 'DELETE') {
        // Follow-spam guard, by IP, KV-backed (survives instance hops).
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'friends-mutate', 40, 60_000)))
            return;
        const targetRaw = String(bodyObj.targetName ?? '').trim();
        const targetSlug = (0, _utils_js_1.safeName)(targetRaw);
        if (!targetSlug)
            return res.status(400).json({ error: 'Invalid target name.' });
        if (targetSlug === playerName)
            return res.status(400).json({ error: "You can't follow yourself." });
        // Lock the follow list for the read-modify-write so two concurrent
        // follows can't both read the old list and one lose its write.
        const next = await (0, _lock_js_1.withKvLock)(key, async () => {
            const current = await _storage_js_1.kv.get(key);
            const list = Array.isArray(current) ? current : [];
            const has = list.some((n) => (0, _utils_js_1.safeName)(n) === targetSlug);
            if (req.method === 'POST') {
                if (has)
                    return list; // already following — idempotent
                if (list.length >= MAX_FOLLOWS)
                    return list; // cap — silently ignore overflow
                // Only follow real accounts (must have a save) so the list can't
                // be stuffed with junk names.
                const exists = await _storage_js_1.kv.get(`save:${targetSlug}`);
                if (!exists)
                    return list;
                const updated = [...list, targetRaw];
                await _storage_js_1.kv.set(key, updated, { ex: FOLLOWS_TTL_SEC });
                return updated;
            }
            // DELETE
            if (!has)
                return list;
            const updated = list.filter((n) => (0, _utils_js_1.safeName)(n) !== targetSlug);
            await _storage_js_1.kv.set(key, updated, { ex: FOLLOWS_TTL_SEC });
            return updated;
        });
        return res.status(200).json({ following: next });
    }
    return res.status(405).end();
}
