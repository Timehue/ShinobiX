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
 * /api/legacy/trial — Legacy Trials, all four stages: 1→2 "Awaken", 2→3
 * "Bind" (adds a cross-category secondary), 3→4 "Prove" (adds a discipline
 * proof), 4→5 "Mythic" (the culmination — both).
 *
 * Trials are fresh-delta objectives over the SERVER-OWNED legacy counters
 * (api/_legacy-track.ts): the baseline is sealed at start, and completion is
 * `current - baseline >= delta` for every objective. Nothing here trusts the
 * client body beyond the action word; failing a trial never unlocks a
 * different legacy (design rule — retry the same path forever).
 *
 *   GET  ?playerName=        → { trial (with live progress), legacy, intro }
 *   POST { action:'start' }  → seal baselines for the next stage's trial
 *   POST { action:'reroll' } → swap to the alternate proof, FRESH baselines, attempt++
 *   POST { action:'complete' } → verify objectives; advance stage; grant title
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Announcement variety (depth-audit finding: one fixed template per event type
// made the 3rd mythic awakening read identically to the 1st). Message pools are
// picked at random and weave in the legacy's own flavor line, so every legacy
// announces in its own voice.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const LEGENDARY_AWAKEN_MSGS = [
    (p, _n, t, f) => `${p} has completed the Trial of the ${t}. ${f}`,
    (p, n, _t, f) => `The ${n} has awakened in ${p}'s hands. ${f}`,
    (p, _n, t, f) => `Word spreads from the trial grounds: ${p} now carries the name "${t}". ${f}`,
];
const MYTHIC_AWAKEN_MSGS = [
    (p, n, _f) => `${p} has awakened the ${n}. The world will remember.`,
    (p, n, f) => `A mythic path has opened its eyes: ${p} carries the ${n}. ${f}`,
    (p, n, _f) => `The taverns will argue about this for a generation — ${p} has awakened the ${n}.`,
];
const MYTHIC_BIND_MSGS = [
    (p, n) => `${p} has bound the ${n} to their soul. Stage III — few will ever stand here.`,
    (p, n) => `The ${n} and ${p} can no longer be told apart. The Binding holds. Stage III.`,
];
const SUMMIT_MSGS = [
    (p, n, t) => `${p} has carried the ${n} to Stage V — Mythic. "${t}" now walks the world.`,
    (p, n, t) => `A path is complete: ${p} stands at the summit of the ${n}. History will use the name "${t}".`,
    (p, n, _t) => `The Hall of Legends has begun carving: the ${n} has reached its summit in ${p}'s hands.`,
];
/** Server-first hall claim with a contention retry: addHallEntry returns null
 *  BOTH when the NX is already claimed and on transient lock contention — only
 *  the second case should retry, or a busy moment could permanently cost the
 *  true first player their once-ever entry (verification finding). */
async function claimServerFirst(entry, nxKey) {
    let e = await (0, _announce_js_1.addHallEntry)(entry, { nxKey });
    if (!e) {
        const claimed = await _storage_js_1.kv.get(`hall:nx:${nxKey}`).catch(() => '1');
        if (!claimed)
            e = await (0, _announce_js_1.addHallEntry)(entry, { nxKey });
    }
    return e;
}
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
            const defForIntro = _legacy_defs_js_1.LEGACY_BY_ID.get(trial.legacyId);
            return res.status(200).json({
                trial: { ...trial, objectives: (0, _legacy_core_js_1.trialProgress)(trial, stats) },
                legacy,
                intro: defForIntro ? (0, _legacy_core_js_1.trialIntroFor)(defForIntro, trial.kind) : null,
            });
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
                    legacyId: legacy.legacyId, kind, startedAt: Date.now(), attempt: 1, variant: 0,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await _storage_js_1.kv.set((0, _legacy_core_js_1.legacyTrialKey)(playerName), trial);
                await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'trial-started', key: `${legacy.legacyId}:${kind}` });
                // Decorated objectives ({progress, done}) like every read path —
                // clients render trial.objectives directly (verification finding:
                // raw {stat, delta} pairs crashed the emissary panel).
                return {
                    status: 200,
                    body: { ok: true, trial: { ...trial, objectives: (0, _legacy_core_js_1.trialProgress)(trial, stats) }, intro: (0, _legacy_core_js_1.trialIntroFor)(def, kind) },
                };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        // ── REROLL: same stage, different proof ──────────────────────────────
        // The Sage's "trials may be retried" made real: swap to the next primary
        // variant with FRESH baselines (attempt++). Never a shortcut — progress
        // resets, only the shape of the ask changes. Objectives are re-derived
        // server-side; nothing in the body is trusted.
        if (action === 'reroll') {
            const out = await (0, _lock_js_1.withKvLock)((0, _legacy_core_js_1.legacyTrialKey)(playerName), async () => {
                const existing = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyTrialKey)(playerName));
                if (!existing)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                const def = _legacy_defs_js_1.LEGACY_BY_ID.get(existing.legacyId);
                if (!def)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName);
                const variant = ((existing.variant ?? 0) + 1) % _legacy_core_js_1.TRIAL_VARIANT_COUNT;
                const objectives = (0, _legacy_core_js_1.trialObjectivesFor)(def, existing.kind, variant);
                const trial = {
                    legacyId: existing.legacyId, kind: existing.kind, startedAt: Date.now(),
                    attempt: (num(existing.attempt) || 1) + 1, variant,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await _storage_js_1.kv.set((0, _legacy_core_js_1.legacyTrialKey)(playerName), trial);
                await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'trial-reroll', key: `${existing.legacyId}:${existing.kind}:${variant}` });
                return {
                    status: 200,
                    body: { ok: true, trial: { ...trial, objectives: (0, _legacy_core_js_1.trialProgress)(trial, stats) }, intro: (0, _legacy_core_js_1.trialIntroFor)(def, existing.kind) },
                };
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
                            message: pick(LEGENDARY_AWAKEN_MSGS)(playerName, def.name, def.title, def.flavor),
                            player: playerName, village, legacyId: def.id,
                        });
                    }
                    else if (def.rarity === 'mythic') {
                        await (0, _announce_js_1.announce)({
                            type: 'mythic_legacy', importance: 'mythic',
                            title: 'MYTHIC LEGACY AWAKENED',
                            message: pick(MYTHIC_AWAKEN_MSGS)(playerName, def.name, def.flavor),
                            player: playerName, village, legacyId: def.id,
                        });
                        await (0, _announce_js_1.addHallEntry)({
                            entryType: 'mythic_legacy',
                            title: def.name,
                            description: `Awakened by ${playerName}${village ? ` of ${village}` : ''}. ${def.flavor}`,
                            player: playerName, village, legacyId: def.id, rarity: def.rarity,
                        }, { nxKey: `mythic-legacy:${def.id}:${playerName}` });
                        // Server-first: the very first mythic awakening on the
                        // server is permanent history. addHallEntry's NX makes
                        // this once-ever — it returns null for every later one.
                        const first = await claimServerFirst({
                            entryType: 'server_first',
                            title: 'First Mythic Awakening',
                            description: `${playerName}${village ? ` of ${village}` : ''} was the first shinobi on the server to awaken a mythic legacy — the ${def.name}.`,
                            player: playerName, village, legacyId: def.id, rarity: def.rarity,
                        }, 'server-first:mythic-awakening');
                        if (first) {
                            await (0, _announce_js_1.announce)({
                                type: 'server_first', importance: 'mythic',
                                title: 'SERVER FIRST — MYTHIC AWAKENING',
                                message: `History: ${playerName} is the FIRST to awaken a mythic legacy. The ${def.name} chose well.`,
                                player: playerName, village, legacyId: def.id,
                            });
                        }
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
                        message: pick(MYTHIC_BIND_MSGS)(playerName, def.name),
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
                        message: pick(SUMMIT_MSGS)(playerName, def.name, (0, _legacy_core_js_1.mythicTitleFor)(def.title)),
                        player: playerName, village, legacyId: def.id,
                    });
                    await (0, _announce_js_1.addHallEntry)({
                        entryType: 'legacy_summit',
                        title: `${def.name} — Stage V`,
                        description: `${playerName}${village ? ` of ${village}` : ''} carried this legacy to its mythic summit. ${def.flavor}`,
                        player: playerName, village, legacyId: def.id, rarity: def.rarity,
                    }, { nxKey: `legacy-summit:${def.id}:${playerName}` });
                    // Server-first summit — once-ever permanent history.
                    const firstSummit = await claimServerFirst({
                        entryType: 'server_first',
                        title: 'First Legacy Summit',
                        description: `${playerName}${village ? ` of ${village}` : ''} was the first shinobi on the server to carry a legacy to Stage V — the ${def.name}.`,
                        player: playerName, village, legacyId: def.id, rarity: def.rarity,
                    }, 'server-first:legacy-summit');
                    if (firstSummit) {
                        await (0, _announce_js_1.announce)({
                            type: 'server_first', importance: 'mythic',
                            title: 'SERVER FIRST — A LEGACY COMPLETED',
                            message: `History: ${playerName} is the FIRST to carry a legacy to its summit. The ${def.name} stands complete.`,
                            player: playerName, village, legacyId: def.id,
                        });
                    }
                }
                const grantedTitleOut = trial.kind === 'awaken' ? def.title
                    : trial.kind === 'prove' ? (0, _legacy_core_js_1.provenTitleFor)(def.title)
                        : trial.kind === 'mythic' ? (0, _legacy_core_js_1.mythicTitleFor)(def.title)
                            : null;
                return {
                    status: 200,
                    body: { ok: true, legacy: saveOut, title: grantedTitleOut, completion: (0, _legacy_core_js_1.trialCompletionFor)(trial.kind) },
                };
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
