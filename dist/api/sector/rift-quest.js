"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _rift_quest_js_1 = require("./_rift-quest.js");
/*
 * /api/sector/rift-quest — POST { action: 'accept' | 'complete' | 'abandon', playerName, riftId? }
 *
 * Server-authoritative wandering-AI RIFT quest (a scaled event Hollow Gate). The
 * Hollow-Gate-boss-kill baseline (character.hollowGateWardenKills — the counter the
 * shrine boss bumps on defeat, NOT totalAiKills, which the Hollow Gate combat path
 * never touches) + target sector are sealed in KV at accept; at complete the server
 * verifies that counter advanced (the boss fell) and pays a recomputed reward,
 * single-use, daily-capped, under the fail-closed save lock. The client flushes the
 * bumped save to the server BEFORE calling complete, so the read is not racy. The
 * character.activeRiftQuest field is a DISPLAY mirror only. No Hollow Gate code is
 * touched — the reward is gated on the boss-kill counter, not the run itself.
 */
const QUEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const questKeyFor = (player) => `rift-quest:${player}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);
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
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `rift-quest-${action}`, 20, 60_000, identity.name)))
            return;
        const questKey = questKeyFor(playerName);
        const def = action === 'abandon' ? null : _rift_quest_js_1.RIFT_QUESTS[String(body.riftId ?? '')];
        if (action !== 'abandon' && !def)
            return res.status(400).json({ error: 'Unknown rift.' });
        // ── ACCEPT: gate-check the real save, seal the foe-kill baseline ──────
        if (action === 'accept' && def) {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                if (await _storage_js_1.kv.get(questKey))
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                if (num(char.level) < def.levelReq)
                    return { status: 200, body: { ok: false, reason: 'level' } };
                if (Date.now() < num(char.riftCooldownUntil))
                    return { status: 200, body: { ok: false, reason: 'cooldown' } };
                const targetSector = (0, _rift_quest_js_1.riftTargetSector)(playerName, def.id);
                const baseline = num(char.hollowGateWardenKills);
                await _storage_js_1.kv.set(questKey, { id: def.id, targetSector, baseline, at: Date.now() }, { ex: QUEST_TTL_SECONDS });
                const activeRiftQuest = { id: def.id, targetSector, stage: 'travel', baseline, bossName: def.bossName };
                const updated = { ...char, activeRiftQuest };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, activeRiftQuest } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── COMPLETE: verify the boss kill, pay, stamp cooldown ──────────────
        if (action === 'complete' && def) {
            const today = utcDateKey();
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const sealed = await _storage_js_1.kv.get(questKey);
                if (!sealed || sealed.id !== def.id)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                if (!(0, _rift_quest_js_1.riftBossKilled)(num(sealed.baseline), num(char.hollowGateWardenKills))) {
                    return { status: 200, body: { ok: false, reason: 'incomplete' } };
                }
                const countKey = `rift-quest-count:${playerName}:${today}`;
                if (num(await _storage_js_1.kv.get(countKey)) >= _rift_quest_js_1.RIFT_DAILY_CAP) {
                    return { status: 200, body: { ok: false, reason: 'daily-cap' } };
                }
                // Burn the single-use seal only now that it is verified, before payout.
                const consumed = await _storage_js_1.kv.del(questKey);
                if (consumed <= 0)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                await _storage_js_1.kv.incr(countKey, { ex: 25 * 60 * 60 });
                const ryo = (0, _rift_quest_js_1.riftQuestRyo)(num(char.level) || 1, def.weight);
                const totalRyo = num(char.ryo) + ryo;
                const totalFateShards = num(char.fateShards) + def.fateShards;
                const totalBoneCharms = num(char.boneCharms) + def.boneCharms;
                const cooldownUntil = Date.now() + _rift_quest_js_1.RIFT_COOLDOWN_MS;
                const updated = {
                    ...char, ryo: totalRyo, fateShards: totalFateShards, boneCharms: totalBoneCharms,
                    activeRiftQuest: null, riftCooldownUntil: cooldownUntil,
                };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                return {
                    status: 200,
                    body: {
                        ok: true, ryo, totalRyo,
                        fateShards: def.fateShards, totalFateShards,
                        boneCharms: def.boneCharms, totalBoneCharms,
                        cooldownUntil,
                    },
                };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── ABANDON: clear the sealed rift ───────────────────────────────────
        if (action === 'abandon') {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                await _storage_js_1.kv.del(questKey).catch(() => undefined);
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (rec && char) {
                    const updated = { ...char, activeRiftQuest: null };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                }
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not update the rift — please retry.' });
        }
        console.error('[sector/rift-quest]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
