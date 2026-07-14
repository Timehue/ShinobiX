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
const _wanderer_encounter_js_1 = require("./_wanderer-encounter.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _era_js_1 = require("../_era.js");
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
        const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
        const naturalWanderer = (0, _wanderer_encounter_js_1.parseNaturalWandererId)(wandererId);
        const sector = Math.max(1, Math.min(60, Math.floor(Number(body.sector ?? 0)) || 0));
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
            // Emissary errands (eq-*) belong to the Legacy wave: no new accepts
            // while ENABLE_LEGACY is off (already-sealed ones still claim, so a
            // kill-switch flip mid-quest never eats a player's progress).
            if (questId.startsWith('eq-') && !(0, _legacy_track_js_1.legacyEnabled)()) {
                return res.status(400).json({ error: 'Unknown quest.' });
            }
            const def = _wanderer_quest_js_1.WANDERER_QUESTS[questId];
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const now = Date.now();
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const existing = (0, _wanderer_quest_js_1.parseWandererQuestSeal)(rec.activeWandererQuestSeal)
                    ?? (0, _wanderer_quest_js_1.parseWandererQuestSeal)(await _storage_js_1.kv.get(questKey));
                if (existing)
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                if (naturalWanderer) {
                    const cooldownUntil = (0, _wanderer_encounter_js_1.currentWandererCooldownUntil)(char, wandererId, now);
                    if (cooldownUntil)
                        return { status: 200, body: { ok: false, reason: 'cooldown', cooldownUntil } };
                }
                const baseline = num(char[def.metric]);
                const sealed = { id: questId, baseline, at: now };
                await _storage_js_1.kv.set(questKey, sealed, { ex: QUEST_TTL_SECONDS });
                // Display mirror on the save (server never trusts this back).
                let updated = { ...char, activeWandererQuest: { id: questId, target: def.target, baseline } };
                const body = { ok: true, id: questId, target: def.target, baseline };
                if (naturalWanderer) {
                    const used = (0, _wanderer_encounter_js_1.withWandererUseState)(updated, wandererId, now, sector);
                    updated = used.character;
                    body.cooldownUntil = used.cooldownUntil;
                    body.moveToSector = used.moveToSector;
                }
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeWandererQuestSeal: sealed, character: updated }), rec));
                return { status: 200, body };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const now = Date.now();
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const durable = (0, _wanderer_quest_js_1.parseWandererQuestSeal)(rec.activeWandererQuestSeal);
                const sealed = durable ?? (0, _wanderer_quest_js_1.parseWandererQuestSeal)(await _storage_js_1.kv.get(questKey));
                if (!sealed) {
                    await _storage_js_1.kv.del(questKey).catch(() => undefined);
                    const updated = { ...char, activeWandererQuest: null };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                    return { status: 200, body: { ok: false, reason: 'none', activeWandererQuest: null, character: updated } };
                }
                const def = _wanderer_quest_js_1.WANDERER_QUESTS[sealed.id];
                const receiptId = `${sealed.id}:${sealed.baseline}:${Number(sealed.at ?? 0)}`;
                const receipts = Array.isArray(char.redeemedWandererQuests) ? char.redeemedWandererQuests : [];
                const prior = receipts.find((entry) => entry.id === receiptId);
                if (prior) {
                    await _storage_js_1.kv.del(questKey).catch(() => undefined);
                    const updated = { ...char, activeWandererQuest: null };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                    return { status: 200, body: { ok: true, replayed: true, ryo: num(prior.ryo), totalRyo: num(char.ryo), activeWandererQuest: null, character: updated } };
                }
                if (naturalWanderer) {
                    const cooldownUntil = (0, _wanderer_encounter_js_1.currentWandererCooldownUntil)(char, wandererId, now);
                    if (cooldownUntil)
                        return { status: 200, body: { ok: false, reason: 'cooldown', cooldownUntil } };
                }
                const current = num(char[def.metric]);
                if (!(0, _wanderer_quest_js_1.wandererQuestComplete)(num(sealed.baseline), current, def.target)) {
                    if (!durable) {
                        await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeWandererQuestSeal: sealed }), rec));
                    }
                    return { status: 200, body: { ok: false, reason: 'incomplete', progress: Math.max(0, current - num(sealed.baseline)), target: def.target } };
                }
                const reward = (0, _wanderer_quest_js_1.wandererQuestRyo)(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + reward;
                let updated = { ...char, ryo: totalRyo, activeWandererQuest: null, redeemedWandererQuests: [...receipts.slice(-49), { id: receiptId, ryo: reward }] };
                const body = { ok: true, ryo: reward, totalRyo, activeWandererQuest: null };
                if (naturalWanderer) {
                    const used = (0, _wanderer_encounter_js_1.withWandererUseState)(updated, wandererId, now, sector);
                    updated = used.character;
                    body.cooldownUntil = used.cooldownUntil;
                    body.moveToSector = used.moveToSector;
                }
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                await _storage_js_1.kv.del(questKey).catch(() => undefined);
                body.character = updated;
                return { status: 200, body };
            }, { failClosed: true });
            // Legacy tracking (ENABLE_LEGACY): AFTER the fail-closed save lock
            // releases — bumpLegacyStats takes its own lock, and nesting it
            // inside a currency critical section adds up to ~900ms of backoff
            // to the lock hold (verification finding).
            if (out.status === 200 && out.body?.ok === true && !out.body.replayed) {
                await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, { wandererQuests: 1 });
                await (0, _era_js_1.bumpEraContribution)('discoveries');
            }
            return res.status(out.status).json(out.body);
        }
        if (action === 'abandon') {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                await _storage_js_1.kv.del(questKey).catch(() => undefined);
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const updated = { ...char, activeWandererQuest: null };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, activeWandererQuestSeal: null, character: updated }), rec));
                return { status: 200, body: { ok: true, activeWandererQuest: null, character: updated } };
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
