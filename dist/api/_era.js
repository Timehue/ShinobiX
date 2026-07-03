"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERA_BY_ID = exports.ERA_DEFS = exports.ERA_STATE_KEY = void 0;
exports.getEraState = getEraState;
exports.readEraContributions = readEraContributions;
exports.currentEraNumber = currentEraNumber;
exports.bumpEraContribution = bumpEraContribution;
exports.effectiveStatus = effectiveStatus;
exports.effectiveRequired = effectiveRequired;
exports.eraMilestonesMet = eraMilestonesMet;
exports.buildEraViews = buildEraViews;
exports.getEraViews = getEraViews;
exports.recordEraTrigger = recordEraTrigger;
exports.checkEraUnlocks = checkEraUnlocks;
exports.unlockEra = unlockEra;
exports.completeEraEffects = completeEraEffects;
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
/** The highest-numbered era currently unlocked — the world's active chapter.
 *  Used to stamp `eraBorn` on a legacy at accept, pinning the accomplishment to
 *  the timeline. Reads the same state + overrides the roster/cron use, so it
 *  can't drift. Defaults to 1 on any read failure (never blocks an accept). */
async function currentEraNumber() {
    try {
        const state = await getEraState();
        let highest = 1;
        for (const def of _era_defs_js_1.ERA_DEFS) {
            if (effectiveStatus(def, state.overrides[def.id]) === 'unlocked' && def.number > highest) {
                highest = def.number;
            }
        }
        return highest;
    }
    catch {
        return 1;
    }
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
            chronicle: def.chronicle,
            status,
            milestones: def.milestones.map((m) => {
                const required = effectiveRequired(def, m.metric, override);
                const current = Math.min(counters[m.metric] ?? 0, required);
                return { metric: m.metric, label: m.label, required, current, done: current >= required };
            }),
            trigger: def.trigger
                ? { label: def.trigger.label, fired: !!trigRec, ...(trigRec ? { firedBy: trigRec.player, ...(trigRec.village ? { firedByVillage: trigRec.village } : {}) } : {}) }
                : null,
            unlockedBy: override?.unlockedBy ?? null,
            unlockedVillage: override?.unlockedVillage ?? null,
            // Launch eras (I–IV) carry no runtime unlock record; fall back to
            // their authored historical timestamp so each has a distinct
            // "Legends of this Age" window (a live override still wins).
            unlockedAt: override?.unlockedAt ?? def.unlockedAt ?? null,
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
        const state = await getEraState();
        for (const def of _era_defs_js_1.ERA_DEFS) {
            if (def.trigger?.kind !== kind)
                continue;
            // Only bank a trigger while the era is actually running its
            // milestone phase — a locked / admin_available / already-unlocked
            // era must not claim its once-ever finisher (verification finding).
            if (effectiveStatus(def, state.overrides[def.id]) !== 'milestone_active')
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
        // Recovery sweep: finish side effects for any gated era that is
        // unlocked but whose effects didn't complete (e.g. a crash between the
        // state flip and the announcement). Idempotent — no-op once done.
        for (const def of _era_defs_js_1.ERA_DEFS) {
            if (!isGatedEra(def))
                continue;
            if (effectiveStatus(def, state.overrides[def.id]) !== 'unlocked')
                continue;
            if (await _storage_js_1.kv.get(effectsDoneKey(def.id)))
                continue;
            await completeEraEffects(def);
        }
    }
    catch (err) {
        console.error('[era] unlock check failed:', err instanceof Error ? err.message : err);
    }
    return unlocked;
}
const effectsDoneKey = (id) => `era:effects-done:${id}`;
const announcedNxKey = (id) => `era:announced:${id}`;
/** Only eras with milestones or a credited trigger emit world-history side
 *  effects. Launch eras (I–IV: no milestones, no trigger, initialStatus
 *  'unlocked') are history that already happened — force-unlocking them must
 *  never broadcast breaking mythic news (verification finding). */
function isGatedEra(def) {
    return def.milestones.length > 0 || !!def.trigger;
}
/**
 * Flip an era to unlocked and drive its once-ever side effects to completion.
 * The STATE flip is idempotent and PRESERVES existing credit (an admin cycling
 * the status can't overwrite unlockedBy/At). The side effects
 * (announce/hall/title) are each individually idempotent and driven by a
 * separate `era:effects-done:<id>` marker — so a crash after the flip is fully
 * recovered by ANY later call (the nightly pass sweeps unlocked-but-incomplete
 * eras), closing the "stranded announcement" window. Returns true when this
 * call performed the state transition.
 */
async function unlockEra(def, credited, _source) {
    const now = Date.now();
    let transitioned = false;
    await (0, _lock_js_1.withKvLock)(exports.ERA_STATE_KEY, async () => {
        const state = await getEraState();
        const override = state.overrides[def.id];
        // Guard on EFFECTIVE status: a launch-unlocked era (I–IV) has no
        // override but is already 'unlocked', so force-unlocking it is a no-op.
        if (effectiveStatus(def, override) === 'unlocked')
            return;
        state.overrides[def.id] = {
            ...override,
            status: 'unlocked',
            // Preserve any credit already recorded; only fill it in on the
            // genuine first unlock.
            unlockedBy: override?.unlockedBy ?? credited?.player ?? null,
            unlockedVillage: override?.unlockedVillage ?? credited?.village ?? null,
            unlockedAt: override?.unlockedAt ?? now,
        };
        await _storage_js_1.kv.set(exports.ERA_STATE_KEY, state);
        transitioned = true;
    }, { failClosed: true });
    if (!isGatedEra(def))
        return transitioned; // launch era: no side effects, ever
    await completeEraEffects(def);
    return transitioned;
}
/** Idempotently finish an unlocked era's side effects. Safe to call repeatedly
 *  (each effect self-guards); the daily pass calls it for any unlocked-but-
 *  incomplete gated era, so nothing stays half-unlocked. */
async function completeEraEffects(def) {
    if (await _storage_js_1.kv.get(effectsDoneKey(def.id)))
        return false;
    const state = await getEraState();
    const override = state.overrides[def.id];
    if (effectiveStatus(def, override) !== 'unlocked')
        return false;
    const player = override?.unlockedBy ?? undefined;
    const village = override?.unlockedVillage ?? undefined;
    const message = def.unlockMessage
        .replace('{player}', player ?? 'the shinobi of the world')
        .replace('{village}', village ?? 'every village');
    // Announce once (NX-guarded so a retry after a crash never double-posts).
    if ((await _storage_js_1.kv.set(announcedNxKey(def.id), '1', { nx: true })) === 'OK') {
        await (0, _announce_js_1.announce)({
            type: 'era_unlock', importance: 'mythic',
            title: def.unlockTitle, message,
            player, village, meta: { eraId: def.id },
        });
    }
    // Permanent Hall entry (own NX via nxKey).
    await (0, _announce_js_1.addHallEntry)({
        entryType: 'era_unlock', title: def.name, description: message,
        player, village, meta: { eraId: def.id },
    }, { nxKey: `era:${def.id}` });
    // Grant the credited finisher their era title (serverTitles = the
    // server-owned ownership source; idempotent includes-check).
    if (player && def.trigger?.title) {
        try {
            await (0, _lock_js_1.withKvLock)(`save:${player}`, async () => {
                const rec = await _storage_js_1.kv.get(`save:${player}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return;
                const earned = Array.isArray(char.earnedTitles) ? char.earnedTitles : [];
                const server = Array.isArray(char.serverTitles) ? char.serverTitles : [];
                if (server.includes(def.trigger.title))
                    return;
                const updated = {
                    ...char,
                    serverTitles: [...server, def.trigger.title],
                    earnedTitles: earned.includes(def.trigger.title) ? earned : [...earned, def.trigger.title],
                };
                await _storage_js_1.kv.set(`save:${player}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
            });
        }
        catch (err) {
            console.error('[era] title grant failed:', err instanceof Error ? err.message : err);
        }
    }
    await _storage_js_1.kv.set(effectsDoneKey(def.id), true);
    console.log(`[era] side effects complete for ${def.id}${player ? ` (credited ${player})` : ''}`);
    return true;
}
/** Nightly cron pass: evaluate unlocks. No-op unless ENABLE_LEGACY=1. */
async function runEraDailyPass() {
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return { enabled: false, unlocked: [] };
    const unlocked = await checkEraUnlocks();
    return { enabled: true, unlocked };
}
