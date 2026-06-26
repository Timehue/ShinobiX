"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _wanderer_quest_js_1 = require("./_wanderer-quest.js");
/*
 * /api/sector/wanderer-quest — POST { action: 'accept' | 'claim', playerName, questId? }
 *
 * Server-authoritative sector-wanderer quest. The baseline (foe-kills at accept)
 * and quest id are sealed in KV; the reward is recomputed from the catalog at
 * claim. The character.activeWandererQuest field is a DISPLAY mirror only — the
 * server never trusts it (see docs/auth-and-anti-cheat-patterns.md).
 *
 *   accept → { ok:true, id, target, baseline } | { ok:false, reason }
 *   claim  → { ok:true, ryo, totalRyo } | { ok:false, reason, progress?, target? }
 */
const QUEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const questKeyFor = (player) => `wanderer-quest:${player}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `wanderer-quest-${action}`, 20, 60_000, identity.name)))
            return;
        const questKey = questKeyFor(playerName);
        // ── ACCEPT ───────────────────────────────────────────────────────────
        if (action === 'accept') {
            const questId = typeof body.questId === 'string' ? body.questId : '';
            if (!(0, _wanderer_quest_js_1.isWandererQuestId)(questId))
                return res.status(400).json({ error: 'Unknown quest.' });
            const def = _wanderer_quest_js_1.WANDERER_QUESTS[questId];
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const existing = await _storage_js_1.kv.get(questKey);
                if (existing)
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const baseline = num(char[def.metric]);
                await _storage_js_1.kv.set(questKey, { id: questId, baseline, at: Date.now() }, { ex: QUEST_TTL_SECONDS });
                // Display mirror on the save (server never trusts this back).
                const updated = { ...char, activeWandererQuest: { id: questId, target: def.target, baseline } };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, id: questId, target: def.target, baseline } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const sealed = await _storage_js_1.kv.get(questKey);
                if (!sealed || !(0, _wanderer_quest_js_1.isWandererQuestId)(sealed.id)) {
                    await _storage_js_1.kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const def = _wanderer_quest_js_1.WANDERER_QUESTS[sealed.id];
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const current = num(char[def.metric]);
                if (!(0, _wanderer_quest_js_1.wandererQuestComplete)(num(sealed.baseline), current, def.target)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - num(sealed.baseline)), target: def.target } };
                }
                const reward = (0, _wanderer_quest_js_1.wandererQuestRyo)(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + reward;
                const updated = { ...char, ryo: totalRyo, activeWandererQuest: null };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                await _storage_js_1.kv.del(questKey).catch(() => undefined);
                return { status: 200, body: { ok: true, ryo: reward, totalRyo } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not update the quest — please retry.' });
        }
        console.error('[sector/wanderer-quest]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
