"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _legacy_defs_js_1 = require("../_legacy-defs.js");
const _legacy_core_js_1 = require("../_legacy-core.js");
const _announce_js_1 = require("../_announce.js");
const _audit_js_1 = require("../_audit.js");
const _era_js_1 = require("../_era.js");
/*
 * /api/legacy/trial — Legacy Trials (stage 1→2 "Awaken", stage 2→3 "Bind").
 *
 * Trials are fresh-delta objectives over the SERVER-OWNED legacy counters
 * (api/_legacy-track.ts): the baseline is sealed at start, and completion is
 * `current - baseline >= delta` for every objective. Nothing here trusts the
 * client body beyond the action word; failing a trial never unlocks a
 * different legacy (design rule — retry the same path forever).
 *
 *   GET  ?playerName=       → { trial (with live progress), legacy }
 *   POST { action:'start' }  → seal baselines for the next stage's trial
 *   POST { action:'complete' } → verify objectives; advance stage; grant title
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(404).json({ error: 'Legacies are not awake yet.' });
    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(isGet ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (isGet) {
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-trial-get', 20, 60_000, identity.name)))
                return;
            const [trial, rec] = await Promise.all([
                _storage_js_1.kv.get((0, _legacy_core_js_1.legacyTrialKey)(playerName)),
                _storage_js_1.kv.get(`save:${playerName}`),
            ]);
            const legacy = (rec?.character?.legacy ?? null);
            if (!trial)
                return res.status(200).json({ trial: null, legacy });
            const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName);
            return res.status(200).json({ trial: { ...trial, objectives: (0, _legacy_core_js_1.trialProgress)(trial, stats) }, legacy });
        }
        if (req.method !== 'POST')
            return res.status(405).end();
        const action = typeof body.action === 'string' ? body.action : '';
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `legacy-trial-${action}`, 10, 60_000, identity.name)))
            return;
        // ── START: seal baselines for the next stage's trial ────────────────
        if (action === 'start') {
            const out = await (0, _lock_js_1.withKvLock)((0, _legacy_core_js_1.legacyTrialKey)(playerName), async () => {
                const sealed = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyAcceptedKey)(playerName));
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                const legacy = (char?.legacy ?? null);
                if (!sealed || !legacy || legacy.legacyId !== sealed.legacyId) {
                    return { status: 200, body: { ok: false, reason: 'no-legacy' } };
                }
                const def = _legacy_defs_js_1.LEGACY_BY_ID.get(legacy.legacyId);
                const kind = (0, _legacy_core_js_1.nextTrialKind)(legacy.stage);
                if (!def || !kind)
                    return { status: 200, body: { ok: false, reason: 'complete' } };
                // A live trial that still matches the current stage is 'busy';
                // one left behind by a stage move or an admin correction is
                // STALE and gets replaced, not honored — otherwise a failed
                // post-completion delete bricks progression forever
                // (verification finding).
                const existing = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyTrialKey)(playerName));
                if (existing && existing.legacyId === legacy.legacyId && existing.kind === kind) {
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                }
                const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName, char);
                const objectives = (0, _legacy_core_js_1.trialObjectivesFor)(def, kind);
                const trial = {
                    legacyId: legacy.legacyId, kind, startedAt: Date.now(), attempt: 1,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await _storage_js_1.kv.set((0, _legacy_core_js_1.legacyTrialKey)(playerName), trial);
                await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'trial-started', key: `${legacy.legacyId}:${kind}` });
                return { status: 200, body: { ok: true, trial } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── COMPLETE: verify deltas, advance stage, grant title ─────────────
        if (action === 'complete') {
            const out = await (0, _lock_js_1.withKvLock)((0, _legacy_core_js_1.legacyTrialKey)(playerName), async () => {
                const trial = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyTrialKey)(playerName));
                if (!trial)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                const def = _legacy_defs_js_1.LEGACY_BY_ID.get(trial.legacyId);
                if (!def)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName);
                const progress = (0, _legacy_core_js_1.trialProgress)(trial, stats);
                if (!progress.every((p) => p.done)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', objectives: progress } };
                }
                const now = Date.now();
                const saveOut = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                    const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                    const char = (rec?.character ?? null);
                    const legacy = (char?.legacy ?? null);
                    if (!rec || !char || !legacy || legacy.legacyId !== trial.legacyId)
                        return null;
                    const next = { ...legacy };
                    let grantedTitle = null;
                    if (trial.kind === 'awaken' && legacy.stage === 1) {
                        next.stage = 2;
                        next.awakenedAt = now;
                        grantedTitle = def.title;
                    }
                    else if (trial.kind === 'bind' && legacy.stage === 2) {
                        next.stage = 3;
                        next.boundAt = now;
                    }
                    else if (trial.kind === 'prove' && legacy.stage === 3) {
                        next.stage = 4;
                        next.provenAt = now;
                        grantedTitle = (0, _legacy_core_js_1.provenTitleFor)(def.title);
                    }
                    else if (trial.kind === 'mythic' && legacy.stage === 4) {
                        next.stage = 5;
                        next.mythicAt = now;
                        grantedTitle = (0, _legacy_core_js_1.mythicTitleFor)(def.title);
                    }
                    else {
                        return null; // stale trial for a stage that already moved
                    }
                    if (grantedTitle) {
                        next.titles = [...new Set([...(legacy.titles ?? []), grantedTitle])];
                    }
                    const earned = Array.isArray(char.earnedTitles) ? char.earnedTitles : [];
                    const updated = {
                        ...char,
                        legacy: next,
                        earnedTitles: grantedTitle ? [...new Set([...earned, grantedTitle])] : earned,
                    };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                    return next;
                }, { failClosed: true });
                if (!saveOut) {
                    // Stage already moved (crash between stage write and trial
                    // delete, or admin correction) — clear the stale trial so
                    // 'start' can mint the right one instead of 'busy' forever.
                    await _storage_js_1.kv.del((0, _legacy_core_js_1.legacyTrialKey)(playerName)).catch(() => undefined);
                    return { status: 200, body: { ok: false, reason: 'stale-cleared' } };
                }
                await _storage_js_1.kv.del((0, _legacy_core_js_1.legacyTrialKey)(playerName));
                await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'trial-complete', key: `${trial.legacyId}:${trial.kind}` });
                await (0, _audit_js_1.recordAudit)({
                    actor: playerName, domain: 'legacy', action: `trial.${trial.kind}.complete`,
                    entityType: 'legacy', entityId: trial.legacyId, meta: { stage: saveOut.stage },
                });
                // Announcement matrix (design handoff): legendary awakenings are
                // 'high'; mythic moments are 'mythic' + a permanent Hall entry.
                if (trial.kind === 'awaken') {
                    const rec2 = await _storage_js_1.kv.get(`save:${playerName}`);
                    const village = String(rec2?.character?.village ?? '') || undefined;
                    // Era system: every awakening feeds the server-wide
                    // milestone; the FIRST MYTHIC awakening is Era V's
                    // credited final trigger (api/_era.ts records it NX).
                    await (0, _era_js_1.bumpEraContribution)('legaciesAwakened');
                    if (def.rarity === 'mythic') {
                        await (0, _era_js_1.recordEraTrigger)('first-mythic-awakening', { player: playerName, village });
                    }
                    if (def.rarity === 'legendary') {
                        await (0, _announce_js_1.announce)({
                            type: 'legacy_awakening', importance: 'high',
                            title: 'LEGENDARY LEGACY AWAKENED',
                            message: `${playerName} has completed the Trial of the ${def.title}. ${def.flavor}`,
                            player: playerName, village, legacyId: def.id,
                        });
                    }
                    else if (def.rarity === 'mythic') {
                        await (0, _announce_js_1.announce)({
                            type: 'mythic_legacy', importance: 'mythic',
                            title: 'MYTHIC LEGACY AWAKENED',
                            message: `${playerName} has awakened the ${def.name}. The world will remember.`,
                            player: playerName, village, legacyId: def.id,
                        });
                        await (0, _announce_js_1.addHallEntry)({
                            entryType: 'mythic_legacy',
                            title: def.name,
                            description: `Awakened by ${playerName}${village ? ` of ${village}` : ''}. ${def.flavor}`,
                            player: playerName, village, legacyId: def.id, rarity: def.rarity,
                        }, { nxKey: `mythic-legacy:${def.id}:${playerName}` });
                    }
                    // Basic/rare awakenings stay quiet by design (importance
                    // matrix: event log only — verification finding restored).
                }
                else if (trial.kind === 'bind' && def.rarity === 'mythic') {
                    const rec2 = await _storage_js_1.kv.get(`save:${playerName}`);
                    const village = String(rec2?.character?.village ?? '') || undefined;
                    await (0, _announce_js_1.announce)({
                        type: 'mythic_legacy', importance: 'high',
                        title: 'A MYTHIC LEGACY IS BOUND',
                        message: `${playerName} has bound the ${def.name} to their soul. Stage III — few will ever stand here.`,
                        player: playerName, village, legacyId: def.id,
                    });
                }
                else if (trial.kind === 'mythic') {
                    // Stage 5 — the summit. Handoff: server announcement + a
                    // permanent Hall of Legends entry, whatever the rarity.
                    // (Stage 4 "Proven" stays event-log quiet by design.)
                    const rec2 = await _storage_js_1.kv.get(`save:${playerName}`);
                    const village = String(rec2?.character?.village ?? '') || undefined;
                    await (0, _announce_js_1.announce)({
                        type: 'legacy_completion', importance: 'mythic',
                        title: 'A LEGACY REACHES ITS SUMMIT',
                        message: `${playerName} has carried the ${def.name} to Stage V — Mythic. "${(0, _legacy_core_js_1.mythicTitleFor)(def.title)}" now walks the world.`,
                        player: playerName, village, legacyId: def.id,
                    });
                    await (0, _announce_js_1.addHallEntry)({
                        entryType: 'legacy_summit',
                        title: `${def.name} — Stage V`,
                        description: `${playerName}${village ? ` of ${village}` : ''} carried this legacy to its mythic summit. ${def.flavor}`,
                        player: playerName, village, legacyId: def.id, rarity: def.rarity,
                    }, { nxKey: `legacy-summit:${def.id}:${playerName}` });
                }
                const grantedTitleOut = trial.kind === 'awaken' ? def.title
                    : trial.kind === 'prove' ? (0, _legacy_core_js_1.provenTitleFor)(def.title)
                        : trial.kind === 'mythic' ? (0, _legacy_core_js_1.mythicTitleFor)(def.title)
                            : null;
                return { status: 200, body: { ok: true, legacy: saveOut, title: grantedTitleOut } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Trial busy — please retry.' });
        }
        console.error('[legacy/trial]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
