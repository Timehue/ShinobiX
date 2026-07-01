"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _questbook_js_1 = require("./_questbook.js");
/*
 * /api/sector/questbook — POST { action, playerName, questId?, optionKey? }
 *
 * Server-authoritative multi-stage "epic" quests (see _questbook.ts). The sealed
 * record { id, stage, baseline, deadline?, choices } lives in KV (one active epic per
 * player); the save's `activeQuestbook` is a DISPLAY mirror the server never trusts.
 * Stage advancement, BRANCH choices, TIMED-stage deadlines, and the final reward are
 * all recomputed/enforced from the sealed catalog against the real character counters.
 *
 *   accept  { questId }   → { ok, id, stage, target } | { ok:false, reason }
 *   advance               → { ok, stage, target, advanced?, readyToClaim?, deadline? } | { ok:false, reason, ... }
 *   choose  { optionKey } → { ok, chose, advanced?, stage?, target?, readyToClaim? } | { ok:false, reason }
 *   claim                 → { ok, ryo, totalRyo, fateShards, title, standings } | { ok:false, reason }
 *   abandon               → { ok:true }
 */
const QUESTBOOK_TTL_SECONDS = 14 * 24 * 60 * 60; // an epic can sit unfinished for two weeks
const DONE_COOLDOWN_SECONDS = 3 * 24 * 60 * 60; // re-roll cooldown after completing one
const questKeyFor = (player) => `questbook:${player}`;
const doneKeyFor = (player, questId) => `questbook:done:${player}:${questId}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** Seal a stage as it becomes active — re-baseline its counter + (re)arm its timer. */
function sealStage(id, stageIdx, char, choices, now) {
    const stage = _questbook_js_1.QUEST_BOOK[id].stages[stageIdx];
    const timerMs = (0, _questbook_js_1.stageTimerMs)(stage);
    return {
        id, stage: stageIdx,
        baseline: num(char[stage.metric]),
        at: now,
        deadline: timerMs > 0 ? now + timerMs : undefined,
        choices,
    };
}
/** The display mirror written onto the save (server never trusts it back). */
function mirrorOf(sealed) {
    const stage = _questbook_js_1.QUEST_BOOK[sealed.id].stages[sealed.stage];
    return {
        id: sealed.id,
        stage: sealed.stage,
        baseline: sealed.baseline,
        target: stage.count,
        deadline: sealed.deadline ?? null,
        choices: sealed.choices ?? {},
    };
}
async function persist(player, saveKey, rec, char, sealed) {
    await _storage_js_1.kv.set(questKeyFor(player), sealed, { ex: QUESTBOOK_TTL_SECONDS });
    const updated = { ...char, activeQuestbook: mirrorOf(sealed) };
    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
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
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `questbook-${action}`, 20, 60_000, identity.name)))
            return;
        const questKey = questKeyFor(playerName);
        const saveKey = `save:${playerName}`;
        // ── ACCEPT ───────────────────────────────────────────────────────────
        if (action === 'accept') {
            const questId = typeof body.questId === 'string' ? body.questId : '';
            if (!(0, _questbook_js_1.isQuestBookId)(questId))
                return res.status(400).json({ error: 'Unknown quest.' });
            const entry = _questbook_js_1.QUEST_BOOK[questId];
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const existing = await _storage_js_1.kv.get(questKey);
                if (existing)
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                const cooling = await _storage_js_1.kv.get(doneKeyFor(playerName, questId));
                if (cooling)
                    return { status: 200, body: { ok: false, reason: 'cooldown' } };
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                if (!(0, _questbook_js_1.bandMatches)(entry, num(char.level) || 1))
                    return { status: 200, body: { ok: false, reason: 'band' } };
                const sealed = sealStage(questId, 0, char, {}, Date.now());
                await persist(playerName, saveKey, rec, char, sealed);
                return { status: 200, body: { ok: true, id: questId, stage: 0, target: entry.stages[0].count, deadline: sealed.deadline ?? null } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── ADVANCE ──────────────────────────────────────────────────────────
        if (action === 'advance') {
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const sealed = await _storage_js_1.kv.get(questKey);
                if (!sealed || !(0, _questbook_js_1.isQuestBookId)(sealed.id)) {
                    await _storage_js_1.kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const entry = _questbook_js_1.QUEST_BOOK[sealed.id];
                const finalIdx = (0, _questbook_js_1.finalStageIndex)(entry);
                const stageIdx = Math.max(0, Math.min(finalIdx, Math.floor(num(sealed.stage))));
                const stage = entry.stages[stageIdx];
                const choices = sealed.choices ?? {};
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const now = Date.now();
                // Timer: lazily arm a missing deadline (migrates in-flight epics); else
                // enforce expiry → reset to the timer's reset stage.
                let working = sealed;
                if ((0, _questbook_js_1.stageTimerMs)(stage) > 0) {
                    if (!sealed.deadline) {
                        working = { ...sealed, deadline: now + (0, _questbook_js_1.stageTimerMs)(stage) };
                        await persist(playerName, saveKey, rec, char, working);
                    }
                    else if (now > sealed.deadline) {
                        const resetIdx = (0, _questbook_js_1.timerResetStage)(entry, stageIdx);
                        const reseal = sealStage(sealed.id, resetIdx, char, choices, now);
                        await persist(playerName, saveKey, rec, char, reseal);
                        return { status: 200, body: { ok: false, reason: 'expired', resetToStage: resetIdx, target: entry.stages[resetIdx].count, deadline: reseal.deadline ?? null } };
                    }
                }
                // Branch: a choice stage advances only via `choose`.
                if ((0, _questbook_js_1.stageIsChoice)(stage) && !choices[stage.key]) {
                    return { status: 200, body: { ok: false, reason: 'choose', stage: stageIdx } };
                }
                const current = num(char[stage.metric]);
                if (!(0, _questbook_js_1.questStageComplete)(num(working.baseline), current, stage.count)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', stage: stageIdx, progress: Math.max(0, current - num(working.baseline)), target: stage.count, deadline: working.deadline ?? null } };
                }
                if (stageIdx >= finalIdx) {
                    return { status: 200, body: { ok: true, stage: stageIdx, readyToClaim: true } };
                }
                const reseal = sealStage(sealed.id, stageIdx + 1, char, choices, now);
                await persist(playerName, saveKey, rec, char, reseal);
                return { status: 200, body: { ok: true, advanced: true, stage: reseal.stage, target: entry.stages[reseal.stage].count, deadline: reseal.deadline ?? null } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── CHOOSE (branch) ──────────────────────────────────────────────────
        if (action === 'choose') {
            const optionKey = typeof body.optionKey === 'string' ? body.optionKey : '';
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const sealed = await _storage_js_1.kv.get(questKey);
                if (!sealed || !(0, _questbook_js_1.isQuestBookId)(sealed.id)) {
                    await _storage_js_1.kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const entry = _questbook_js_1.QUEST_BOOK[sealed.id];
                const finalIdx = (0, _questbook_js_1.finalStageIndex)(entry);
                const stageIdx = Math.max(0, Math.min(finalIdx, Math.floor(num(sealed.stage))));
                const stage = entry.stages[stageIdx];
                if (!(0, _questbook_js_1.stageIsChoice)(stage))
                    return { status: 200, body: { ok: false, reason: 'no-choice' } };
                if (!(0, _questbook_js_1.choiceOption)(stage, optionKey))
                    return { status: 200, body: { ok: false, reason: 'bad-option' } };
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const now = Date.now();
                const choices = { ...(sealed.choices ?? {}), [stage.key]: optionKey };
                if (stageIdx >= finalIdx) {
                    await persist(playerName, saveKey, rec, char, { ...sealed, choices });
                    return { status: 200, body: { ok: true, chose: optionKey, readyToClaim: true } };
                }
                const reseal = sealStage(sealed.id, stageIdx + 1, char, choices, now);
                await persist(playerName, saveKey, rec, char, reseal);
                return { status: 200, body: { ok: true, chose: optionKey, advanced: true, stage: reseal.stage, target: entry.stages[reseal.stage].count, deadline: reseal.deadline ?? null } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── CLAIM ────────────────────────────────────────────────────────────
        if (action === 'claim') {
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const sealed = await _storage_js_1.kv.get(questKey);
                if (!sealed || !(0, _questbook_js_1.isQuestBookId)(sealed.id)) {
                    await _storage_js_1.kv.del(questKey).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                const entry = _questbook_js_1.QUEST_BOOK[sealed.id];
                const finalIdx = (0, _questbook_js_1.finalStageIndex)(entry);
                if (Math.floor(num(sealed.stage)) < finalIdx) {
                    return { status: 200, body: { ok: false, reason: 'not-final', stage: num(sealed.stage) } };
                }
                const stage = entry.stages[finalIdx];
                const choices = sealed.choices ?? {};
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const now = Date.now();
                // A timed final stage must still be within its deadline.
                if ((0, _questbook_js_1.stageTimerMs)(stage) > 0 && sealed.deadline && now > sealed.deadline) {
                    const resetIdx = (0, _questbook_js_1.timerResetStage)(entry, finalIdx);
                    const reseal = sealStage(sealed.id, resetIdx, char, choices, now);
                    await persist(playerName, saveKey, rec, char, reseal);
                    return { status: 200, body: { ok: false, reason: 'expired', resetToStage: resetIdx, target: entry.stages[resetIdx].count } };
                }
                if ((0, _questbook_js_1.stageIsChoice)(stage) && !choices[stage.key]) {
                    return { status: 200, body: { ok: false, reason: 'choose', stage: finalIdx } };
                }
                const current = num(char[stage.metric]);
                if (!(0, _questbook_js_1.questStageComplete)(num(sealed.baseline), current, stage.count)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', stage: finalIdx, progress: Math.max(0, current - num(sealed.baseline)), target: stage.count } };
                }
                const consumed = await _storage_js_1.kv.del(questKey);
                if (consumed <= 0)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                // Apply sealed branch effects to the reward.
                const fx = (0, _questbook_js_1.aggregateChoiceEffects)(entry, choices);
                const ryo = Math.round((0, _questbook_js_1.questBookRyo)(num(char.level) || 1, entry.weight) * fx.ryoMult);
                const fateAward = entry.fateShards + fx.bonusFateShards;
                const awardTitle = fx.titleOverride ?? entry.award;
                const totalRyo = num(char.ryo) + ryo;
                const fateShards = num(char.fateShards) + fateAward;
                const prevTitles = Array.isArray(char.questTitles) ? char.questTitles.filter(t => typeof t === 'string') : [];
                const questTitles = prevTitles.includes(awardTitle) ? prevTitles : [...prevTitles, awardTitle];
                const prevStandings = Array.isArray(char.questStandings) ? char.questStandings.filter(t => typeof t === 'string') : [];
                const questStandings = [...prevStandings];
                for (const s of fx.standings)
                    if (!questStandings.includes(s))
                        questStandings.push(s);
                const updated = { ...char, ryo: totalRyo, fateShards, questTitles, questStandings, activeQuestbook: null };
                // The capstone ends the rivalry for good (its whole point).
                if (entry.clearsRivalry)
                    updated.wandererNemesis = null;
                await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                await _storage_js_1.kv.set(doneKeyFor(playerName, entry.id), Date.now(), { ex: DONE_COOLDOWN_SECONDS });
                return { status: 200, body: { ok: true, ryo, totalRyo, fateShards: fateAward, title: awardTitle, standings: fx.standings, clearedRivalry: !!entry.clearsRivalry } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── ABANDON ──────────────────────────────────────────────────────────
        if (action === 'abandon') {
            const out = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                await _storage_js_1.kv.del(questKey).catch(() => undefined);
                const rec = await _storage_js_1.kv.get(saveKey);
                const char = (rec?.character ?? null);
                if (rec && char) {
                    const updated = { ...char, activeQuestbook: null };
                    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                }
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not update the quest — please retry.' });
        }
        console.error('[sector/questbook]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
