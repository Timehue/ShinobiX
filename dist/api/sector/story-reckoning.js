"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _story_reckoning_js_1 = require("./_story-reckoning.js");
const TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
const tokenKeyFor = (player) => `story-reckoning:${player}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);
const strArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
function mirrorFor(def, stage, baseline) {
    return { id: def.id, stage, metric: def.metric, baseline, target: def.target, dropItemId: def.dropItemId };
}
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
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `story-reckoning-${action}`, 30, 60_000, identity.name)))
            return;
        const saveKey = `save:${playerName}`;
        const tokenKey = tokenKeyFor(playerName);
        const def = action === 'abandon' ? null : _story_reckoning_js_1.STORY_RECKONINGS[String(body.questId ?? '')];
        if (action !== 'abandon' && !def)
            return res.status(400).json({ error: 'Unknown reckoning.' });
        if (action === 'accept' && def) {
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                if (!(0, _story_reckoning_js_1.storyReckoningEligible)(char, def))
                    return { status: 200, body: { ok: false, reason: 'ineligible' } };
                const existing = (0, _story_reckoning_js_1.parseStoryReckoningSeal)(rec.activeStoryReckoningSeal)
                    ?? (0, _story_reckoning_js_1.parseStoryReckoningSeal)(await _storage_js_1.kv.get(tokenKey));
                if (char.activeQuestbook || char.activeRiftQuest || existing)
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                const baseline = num(char[def.metric]);
                const sealed = { id: def.id, stage: 'task', baseline, at: Date.now() };
                await _storage_js_1.kv.set(tokenKey, sealed, { ex: TOKEN_TTL_SECONDS });
                const activeStoryReckoning = mirrorFor(def, 'task', baseline);
                const updated = { ...char, activeStoryReckoning };
                await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: sealed, character: updated }), rec));
                return { status: 200, body: { ok: true, activeStoryReckoning } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        if (action === 'report' && def) {
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const durable = (0, _story_reckoning_js_1.parseStoryReckoningSeal)(rec.activeStoryReckoningSeal);
                const sealed = durable ?? (0, _story_reckoning_js_1.parseStoryReckoningSeal)(await _storage_js_1.kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id) {
                    if (!sealed && char.activeStoryReckoning?.id === def.id) {
                        const updated = { ...char, activeStoryReckoning: null };
                        await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: null, character: updated }), rec));
                        return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: null, character: updated } };
                    }
                    return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: char.activeStoryReckoning ?? null, character: char } };
                }
                if (sealed.stage === 'return') {
                    return { status: 200, body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning: mirrorFor(def, 'return', num(sealed.baseline)), character: char } };
                }
                const current = num(char[def.metric]);
                if (!(0, _story_reckoning_js_1.storyReckoningTaskComplete)(sealed.baseline, current, def.target)) {
                    if (!durable)
                        await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: sealed }), rec));
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - sealed.baseline), target: def.target } };
                }
                const inventory = Array.isArray(char.inventory) ? [...char.inventory] : [];
                if ((0, _story_reckoning_js_1.ownedItemCount)(char, def.dropItemId) < 1)
                    inventory.push(def.dropItemId);
                const nextSeal = { ...sealed, stage: 'return' };
                await _storage_js_1.kv.set(tokenKey, nextSeal, { ex: TOKEN_TTL_SECONDS });
                const activeStoryReckoning = mirrorFor(def, 'return', sealed.baseline);
                const updated = { ...char, inventory, activeStoryReckoning };
                await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: nextSeal, character: updated }), rec));
                return { status: 200, body: { ok: true, dropItemId: def.dropItemId, activeStoryReckoning, character: updated } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        if (action === 'turn-in' && def) {
            const today = utcDateKey();
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const sealed = (0, _story_reckoning_js_1.parseStoryReckoningSeal)(rec.activeStoryReckoningSeal)
                    ?? (0, _story_reckoning_js_1.parseStoryReckoningSeal)(await _storage_js_1.kv.get(tokenKey));
                if (!sealed || sealed.id !== def.id) {
                    if (!sealed && char.activeStoryReckoning?.id === def.id) {
                        const updated = { ...char, activeStoryReckoning: null };
                        await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: null, character: updated }), rec));
                        return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: null, character: updated } };
                    }
                    return { status: 200, body: { ok: false, reason: 'none', activeStoryReckoning: char.activeStoryReckoning ?? null, character: char } };
                }
                if (sealed.stage !== 'return')
                    return { status: 200, body: { ok: false, reason: 'incomplete' } };
                if ((0, _story_reckoning_js_1.ownedItemCount)(char, def.dropItemId) < 1)
                    return { status: 200, body: { ok: false, reason: 'no-item' } };
                const countKey = `story-reckoning-count:${playerName}:${today}`;
                if (num(await _storage_js_1.kv.get(countKey)) >= _story_reckoning_js_1.STORY_RECKONING_DAILY_CAP) {
                    return { status: 200, body: { ok: false, reason: 'daily-cap' } };
                }
                await _storage_js_1.kv.del(tokenKey).catch(() => undefined);
                await _storage_js_1.kv.incr(countKey, { ex: 25 * 60 * 60 });
                const ryo = (0, _story_reckoning_js_1.storyReckoningRyo)(char.level, def.weight);
                const totalRyo = num(char.ryo) + ryo;
                const totalFateShards = num(char.fateShards) + def.fateShards;
                const questTitles = strArray(char.questTitles);
                if (!questTitles.includes(def.title))
                    questTitles.push(def.title);
                const storyTraits = strArray(char.storyTraits);
                if (!storyTraits.includes(def.completionTrait))
                    storyTraits.push(def.completionTrait);
                const updated = { ...char, ryo: totalRyo, fateShards: totalFateShards, questTitles, storyTraits, activeStoryReckoning: null };
                await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: null, character: updated }), rec));
                return { status: 200, body: { ok: true, ryo, totalRyo, fateShards: def.fateShards, totalFateShards, title: def.title, questTitles, completionTrait: def.completionTrait, activeStoryReckoning: null, character: updated } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        if (action === 'abandon') {
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                await _storage_js_1.kv.del(tokenKey).catch(() => undefined);
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (rec && char) {
                    const updated = { ...char, activeStoryReckoning: null };
                    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeStoryReckoningSeal: null, character: updated }), rec));
                    return { status: 200, body: { ok: true, activeStoryReckoning: null, character: updated } };
                }
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not update the reckoning. Please retry.' });
        }
        console.error('[sector/story-reckoning]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
