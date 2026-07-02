"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERA_BY_ID = exports.ERA_DEFS = exports.ERA_STATE_KEY = void 0;
exports.getEraState = getEraState;
exports.readEraContributions = readEraContributions;
exports.bumpEraContribution = bumpEraContribution;
exports.effectiveStatus = effectiveStatus;
exports.effectiveRequired = effectiveRequired;
exports.eraMilestonesMet = eraMilestonesMet;
exports.buildEraViews = buildEraViews;
exports.getEraViews = getEraViews;
exports.recordEraTrigger = recordEraTrigger;
exports.checkEraUnlocks = checkEraUnlocks;
exports.unlockEra = unlockEra;
exports.runEraDailyPass = runEraDailyPass;
/*
 * Era engine — contribution counters, milestone evaluation, and the unlock
 * transaction (docs/legacy-system-plan.md §14).
 *
 * State model: definitions are static (api/_era-defs.ts); the KV row
 * `game:era-state` stores only OVERRIDES (admin status/milestone tuning) and
 * unlock records. Contributions are global `era:contrib:<metric>` counters
 * bumped with atomic kv.incr from the same settle endpoints that feed Legacy
 * tracking — contention-free by design (plan §14.3).
 *
 * The credited trigger can land BEFORE the milestones finish: it is recorded
 * once (NX) at `era:trigger:<id>` and honored when the nightly pass finds the
 * milestones complete — the finisher keeps their credit either way.
 * Unlocking is exactly-once via the `era:unlocked:<id>` NX marker.
 */
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _announce_js_1 = require("./_announce.js");
const _legacy_track_js_1 = require("./_legacy-track.js");
const _save_version_js_1 = require("./save/_save-version.js");
const _utils_js_1 = require("./_utils.js");
const _era_defs_js_1 = require("./_era-defs.js");
Object.defineProperty(exports, "ERA_DEFS", { enumerable: true, get: function () { return _era_defs_js_1.ERA_DEFS; } });
Object.defineProperty(exports, "ERA_BY_ID", { enumerable: true, get: function () { return _era_defs_js_1.ERA_BY_ID; } });
exports.ERA_STATE_KEY = 'game:era-state';
const contribKey = (m) => `era:contrib:${m}`;
const unlockedNxKey = (id) => `era:unlocked:${id}`;
const triggerKey = (id) => `era:trigger:${id}`;
async function getEraState() {
    try {
        const raw = await _storage_js_1.kv.get(exports.ERA_STATE_KEY);
        return raw && typeof raw === 'object' && raw.overrides ? raw : { overrides: {} };
    }
    catch {
        return { overrides: {} };
    }
}
async function readEraContributions() {
    const out = {};
    for (const m of _era_defs_js_1.ERA_METRICS) {
        out[m] = Math.max(0, Math.floor(Number(await _storage_js_1.kv.get(contribKey(m))) || 0));
    }
    return out;
}
/** Fire-and-forget global contribution bump from settle endpoints. */
async function bumpEraContribution(metric, n = 1) {
    if (!(0, _legacy_track_js_1.legacyEnabled)() || n <= 0)
        return;
    try {
        for (let i = 0; i < n; i++)
            await _storage_js_1.kv.incr(contribKey(metric));
    }
    catch (err) {
        console.error(`[era] contribution bump failed (${metric}):`, err instanceof Error ? err.message : err);
    }
}
// ─── Pure helpers (unit-tested in _era.test.ts) ─────────────────────────────
function effectiveStatus(def, override) {
    return override?.status ?? def.initialStatus;
}
function effectiveRequired(def, metric, override) {
    const o = Number(override?.milestoneOverrides?.[metric]);
    const base = def.milestones.find((m) => m.metric === metric)?.required ?? 0;
    return Number.isFinite(o) && o >= 0 ? o : base;
}
function eraMilestonesMet(def, counters, override) {
    return def.milestones.every((m) => (counters[m.metric] ?? 0) >= effectiveRequired(def, m.metric, override));
}
function buildEraViews(state, counters, triggers) {
    return _era_defs_js_1.ERA_DEFS.map((def) => {
        const override = state.overrides[def.id];
        const status = effectiveStatus(def, override);
        const trigRec = triggers[def.id] ?? null;
        return {
            id: def.id, number: def.number, name: def.name,
            description: def.description, lore: def.lore, banner: def.banner,
            status,
            milestones: def.milestones.map((m) => {
                const required = effectiveRequired(def, m.metric, override);
                const current = Math.min(counters[m.metric] ?? 0, required);
                return { metric: m.metric, label: m.label, required, current, done: current >= required };
            }),
            trigger: def.trigger
                ? { label: def.trigger.label, fired: !!trigRec, ...(trigRec ? { firedBy: trigRec.player } : {}) }
                : null,
            unlockedBy: override?.unlockedBy ?? null,
            unlockedVillage: override?.unlockedVillage ?? null,
            unlockedAt: override?.unlockedAt ?? null,
        };
    });
}
async function getEraViews() {
    const [state, counters] = await Promise.all([getEraState(), readEraContributions()]);
    const triggers = {};
    for (const def of _era_defs_js_1.ERA_DEFS) {
        triggers[def.id] = def.trigger ? await _storage_js_1.kv.get(triggerKey(def.id)) : null;
    }
    return buildEraViews(state, counters, triggers);
}
// ─── Trigger + unlock transaction ───────────────────────────────────────────
/**
 * Record a credited final trigger (first caller wins, NX). Then attempt the
 * unlock immediately — if milestones are already met the finisher sees their
 * era open in real time; otherwise the record waits for the nightly pass.
 */
async function recordEraTrigger(kind, credited) {
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return;
    try {
        for (const def of _era_defs_js_1.ERA_DEFS) {
            if (def.trigger?.kind !== kind)
                continue;
            await _storage_js_1.kv.set(triggerKey(def.id), { player: credited.player, village: credited.village, ts: Date.now() }, { nx: true });
            await checkEraUnlocks();
        }
    }
    catch (err) {
        console.error('[era] trigger record failed:', err instanceof Error ? err.message : err);
    }
}
/**
 * Evaluate every milestone_active era and unlock the ones that are complete
 * (milestones met + trigger fired when required). Exactly-once per era via
 * the NX marker; safe to call from the cron pass, trigger hooks, and admin.
 */
async function checkEraUnlocks() {
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return [];
    const unlocked = [];
    try {
        const [state, counters] = await Promise.all([getEraState(), readEraContributions()]);
        for (const def of _era_defs_js_1.ERA_DEFS) {
            const override = state.overrides[def.id];
            if (effectiveStatus(def, override) !== 'milestone_active')
                continue;
            if (!eraMilestonesMet(def, counters, override))
                continue;
            let credited = null;
            if (def.trigger) {
                credited = await _storage_js_1.kv.get(triggerKey(def.id));
                if (!credited)
                    continue; // waiting on the finisher
            }
            const did = await unlockEra(def, credited, 'milestone');
            if (did)
                unlocked.push(def.id);
        }
    }
    catch (err) {
        console.error('[era] unlock check failed:', err instanceof Error ? err.message : err);
    }
    return unlocked;
}
/** The unlock transaction. Returns true only for the run that actually flips it.
 *  Order matters (same lesson as the Sage accept fix): the STATE write commits
 *  first under the fail-closed lock — it is the source of truth and is
 *  repairable by retry. The NX marker guards only the once-ever side effects
 *  (announcement/hall/title), so a crash between the two can never leave the
 *  era half-unlocked, and an admin later cycling the status back to
 *  milestone_active can't re-announce world history. */
async function unlockEra(def, credited, source) {
    const now = Date.now();
    let flipped = false;
    await (0, _lock_js_1.withKvLock)(exports.ERA_STATE_KEY, async () => {
        const state = await getEraState();
        if (state.overrides[def.id]?.status === 'unlocked')
            return;
        state.overrides[def.id] = {
            ...state.overrides[def.id],
            status: 'unlocked',
            unlockedBy: credited?.player ?? null,
            unlockedVillage: credited?.village ?? null,
            unlockedAt: now,
        };
        await _storage_js_1.kv.set(exports.ERA_STATE_KEY, state);
        flipped = true;
    }, { failClosed: true });
    if (!flipped)
        return false;
    const claimed = await _storage_js_1.kv.set(unlockedNxKey(def.id), { ts: now, source }, { nx: true });
    if (claimed !== 'OK')
        return true; // state repaired; history already written
    const message = def.unlockMessage
        .replace('{player}', credited?.player ?? 'the shinobi of the world')
        .replace('{village}', credited?.village ?? 'every village');
    await (0, _announce_js_1.announce)({
        type: 'era_unlock', importance: 'mythic',
        title: def.unlockTitle, message,
        player: credited?.player, village: credited?.village,
        meta: { eraId: def.id, source },
    });
    await (0, _announce_js_1.addHallEntry)({
        entryType: 'era_unlock',
        title: def.name,
        description: message,
        player: credited?.player, village: credited?.village,
        meta: { eraId: def.id },
    }, { nxKey: `era:${def.id}` });
    // Grant the credited finisher their era title (best-effort, save-locked).
    if (credited?.player && def.trigger?.title) {
        try {
            await (0, _lock_js_1.withKvLock)(`save:${credited.player}`, async () => {
                const rec = await _storage_js_1.kv.get(`save:${credited.player}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return;
                const earned = Array.isArray(char.earnedTitles) ? char.earnedTitles : [];
                if (earned.includes(def.trigger.title))
                    return;
                const updated = { ...char, earnedTitles: [...earned, def.trigger.title] };
                await _storage_js_1.kv.set(`save:${credited.player}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
            });
        }
        catch (err) {
            console.error('[era] title grant failed:', err instanceof Error ? err.message : err);
        }
    }
    console.log(`[era] UNLOCKED ${def.id} (${source})${credited ? ` credited to ${credited.player}` : ''}`);
    return true;
}
/** Nightly cron pass: evaluate unlocks. No-op unless ENABLE_LEGACY=1. */
async function runEraDailyPass() {
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return { enabled: false, unlocked: [] };
    const unlocked = await checkEraUnlocks();
    return { enabled: true, unlocked };
}
