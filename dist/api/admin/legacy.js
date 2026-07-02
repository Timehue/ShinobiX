"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _legacy_score_js_1 = require("../_legacy-score.js");
const _legacy_defs_js_1 = require("../_legacy-defs.js");
const _legacy_core_js_1 = require("../_legacy-core.js");
const _audit_js_1 = require("../_audit.js");
const _announce_js_1 = require("../_announce.js");
const _titles_registry_js_1 = require("../_titles-registry.js");
const _era_js_1 = require("../_era.js");
const _titles_registry_js_2 = require("../_titles-registry.js");
/*
 * POST /api/admin/legacy — the Legacy admin MVP (docs/legacy-system-plan.md §16).
 * Full-admin only. Every mutating action records an audit entry in the
 * 'legacy' domain; emergency-change additionally requires a reason (design
 * rule: admin correction exists only for bugs, and it leaves a trail).
 *
 * Actions:
 *   view              { player }                    → stats/evals/offer/trial/events
 *   recalc            { player }                    → fresh evaluation summary
 *   force-spawn       { player }                    → note: use sage roll with force
 *   emergency-change  { player, legacyId|null, reason }
 *   get-overlay       {}                            → shared:legacy-defs tuning
 *   set-overlay       { overlay }
 *   hall-correct      { entryId, status?, correctionNote?, reason }
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isFullAdmin)(req))
        return res.status(401).json({ error: 'Admin authentication required.' });
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(404).json({ error: 'ENABLE_LEGACY is not set.' });
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        if (action === 'view' || action === 'recalc') {
            const player = (0, _utils_js_1.safeName)(String(body.player ?? ''));
            if (!player)
                return res.status(400).json({ error: 'Missing player.' });
            const rec = await _storage_js_1.kv.get(`save:${player}`);
            const char = (rec?.character ?? null);
            if (!char)
                return res.status(404).json({ error: 'Save not found.' });
            const stats = await (0, _legacy_track_js_1.getLegacyStats)(player, char);
            const overlay = await (0, _legacy_score_js_1.getLegacyOverlay)();
            const evals = (0, _legacy_score_js_1.evaluateAllLegacies)(stats, {
                level: num(char.level), village: typeof char.village === 'string' ? char.village : null, overlay,
            });
            const [offer, trial, sealed, events] = await Promise.all([
                _storage_js_1.kv.get(`legacy:sage-offer:${player}`),
                _storage_js_1.kv.get((0, _legacy_core_js_1.legacyTrialKey)(player)),
                _storage_js_1.kv.get((0, _legacy_core_js_1.legacyAcceptedKey)(player)),
                _storage_js_1.kv.get((0, _legacy_track_js_1.legacyEventsKey)(player)),
            ]);
            return res.status(200).json({
                player, stats,
                legacy: (char.legacy ?? null),
                sealed: sealed ?? null,
                offer: offer ?? null,
                trial: trial ?? null,
                events: Array.isArray(events) ? events.slice(0, 50) : [],
                eligible: evals.filter((e) => e.eligible),
                nearMisses: evals.filter((e) => !e.eligible && e.score >= 0.6).slice(0, 15),
            });
        }
        if (action === 'emergency-change') {
            const player = (0, _utils_js_1.safeName)(String(body.player ?? ''));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            const legacyId = body.legacyId === null ? null : String(body.legacyId ?? '');
            if (!player)
                return res.status(400).json({ error: 'Missing player.' });
            if (!reason)
                return res.status(400).json({ error: 'A reason is required for emergency corrections.' });
            if (legacyId !== null && !_legacy_defs_js_1.LEGACY_BY_ID.has(legacyId))
                return res.status(400).json({ error: 'Unknown legacy.' });
            const out = await (0, _lock_js_1.withKvLock)(`legacy:accept:${player}`, async () => {
                const prev = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyAcceptedKey)(player));
                const saveOk = await (0, _lock_js_1.withKvLock)(`save:${player}`, async () => {
                    const rec = await _storage_js_1.kv.get(`save:${player}`);
                    const char = (rec?.character ?? null);
                    if (!rec || !char)
                        return false;
                    const now = Date.now();
                    const legacy = legacyId === null ? null : {
                        legacyId, stage: 1, acceptedAt: now, titles: [],
                    };
                    const updated = { ...char, legacy };
                    await _storage_js_1.kv.set(`save:${player}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                    return true;
                }, { failClosed: true });
                if (!saveOk)
                    return { status: 404, body: { error: 'Save not found.' } };
                if (legacyId === null) {
                    await _storage_js_1.kv.del((0, _legacy_core_js_1.legacyAcceptedKey)(player));
                }
                else {
                    await _storage_js_1.kv.set((0, _legacy_core_js_1.legacyAcceptedKey)(player), { legacyId, ts: Date.now(), adminSet: true });
                }
                await _storage_js_1.kv.del((0, _legacy_core_js_1.legacyTrialKey)(player));
                await (0, _legacy_track_js_1.appendLegacyEvent)(player, { type: 'admin-correction', key: legacyId ?? 'cleared', meta: { reason } });
                await (0, _audit_js_1.recordAudit)({
                    actor: 'admin', domain: 'legacy', action: 'legacy.emergency-change',
                    entityType: 'player', entityId: player,
                    before: prev?.legacyId ?? null, after: legacyId, reason,
                });
                return { status: 200, body: { ok: true, previous: prev?.legacyId ?? null, current: legacyId } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        if (action === 'get-overlay') {
            return res.status(200).json({ overlay: await (0, _legacy_score_js_1.getLegacyOverlay)() });
        }
        if (action === 'set-overlay') {
            const overlay = (body.overlay ?? {});
            if (typeof overlay !== 'object' || Array.isArray(overlay)) {
                return res.status(400).json({ error: 'Overlay must be an object.' });
            }
            const before = await (0, _legacy_score_js_1.getLegacyOverlay)();
            await _storage_js_1.kv.set(_legacy_score_js_1.LEGACY_OVERLAY_KEY, overlay);
            await (0, _audit_js_1.recordAudit)({
                actor: 'admin', domain: 'legacy', action: 'legacy.overlay-set',
                before, after: overlay,
            });
            return res.status(200).json({ ok: true });
        }
        if (action === 'reset-tracking') {
            // Testing tool: wipe a player's side-car counters (NOT their legacy).
            const player = (0, _utils_js_1.safeName)(String(body.player ?? ''));
            if (!player)
                return res.status(400).json({ error: 'Missing player.' });
            await _storage_js_1.kv.del((0, _legacy_track_js_1.legacyStatsKey)(player));
            await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'legacy.reset-tracking', entityType: 'player', entityId: player });
            return res.status(200).json({ ok: true });
        }
        if (action === 'suspects') {
            const suspects = (await _storage_js_1.kv.get(_legacy_track_js_1.LEGACY_SUSPECTS_KEY)) ?? [];
            return res.status(200).json({ suspects: Array.isArray(suspects) ? suspects : [] });
        }
        if (action === 'clear-suspicion') {
            // Small-server relief valve: a trio of honest regulars dueling each
            // other can trip the ring detector; this clears the flags WITHOUT
            // wiping their earned progression (unlike reset-tracking). Audited.
            const player = (0, _utils_js_1.safeName)(String(body.player ?? ''));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if (!player)
                return res.status(400).json({ error: 'Missing player.' });
            if (!reason)
                return res.status(400).json({ error: 'A reason is required.' });
            await (0, _lock_js_1.withKvLock)((0, _legacy_track_js_1.legacyStatsKey)(player), async () => {
                const stats = await _storage_js_1.kv.get((0, _legacy_track_js_1.legacyStatsKey)(player));
                if (!stats)
                    return;
                await _storage_js_1.kv.set((0, _legacy_track_js_1.legacyStatsKey)(player), { ...stats, suspicionFlags: 0, ringFlagAt: 0, recentWinTargets: [] });
            }, { failClosed: true });
            await (0, _lock_js_1.withKvLock)(_legacy_track_js_1.LEGACY_SUSPECTS_KEY, async () => {
                const suspects = (await _storage_js_1.kv.get(_legacy_track_js_1.LEGACY_SUSPECTS_KEY)) ?? [];
                await _storage_js_1.kv.set(_legacy_track_js_1.LEGACY_SUSPECTS_KEY, (Array.isArray(suspects) ? suspects : []).filter((s) => s.player !== player));
            }, { ttlSec: 5 });
            await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'legacy.clear-suspicion', entityType: 'player', entityId: player, reason });
            return res.status(200).json({ ok: true });
        }
        // ── Custom-title moderation (§11.4: filter-first + post-hoc review) ──
        if (action === 'titles-log') {
            const log = (await _storage_js_1.kv.get(_titles_registry_js_2.CUSTOM_TITLE_LOG_KEY)) ?? [];
            return res.status(200).json({ log: Array.isArray(log) ? log.slice(0, 100) : [] });
        }
        if (action === 'title-revoke') {
            const player = (0, _utils_js_1.safeName)(String(body.player ?? ''));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            const refund = body.refund !== false; // default: refund the 10 shards
            if (!player)
                return res.status(400).json({ error: 'Missing player.' });
            if (!reason)
                return res.status(400).json({ error: 'A reason is required to revoke a title.' });
            const out = await (0, _lock_js_1.withKvLock)(`save:${player}`, async () => {
                const rec = await _storage_js_1.kv.get(`save:${player}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Save not found.' } };
                const previous = String(char.customTitle ?? '');
                if (!previous)
                    return { status: 200, body: { ok: false, reason: 'no-title' } };
                const updated = {
                    ...char,
                    customTitle: '',
                    ...(refund ? { fateShards: Math.max(0, Number(char.fateShards ?? 0)) + 10 } : {}),
                };
                await _storage_js_1.kv.set(`save:${player}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true, previous, refunded: refund ? 10 : 0 } };
            }, { failClosed: true });
            if (out.status === 200 && out.body.ok) {
                await (0, _audit_js_1.recordAudit)({
                    actor: 'admin', domain: 'legacy', action: 'title.revoke',
                    entityType: 'player', entityId: player,
                    before: out.body.previous, after: '', reason,
                    meta: { refunded: out.body.refunded },
                });
            }
            return res.status(out.status).json(out.body);
        }
        if (action === 'title-grant') {
            // Manual grant of a REGISTERED earned title (handoff Admin MVP:
            // "grant/revoke titles"). Registry-only so an admin can't mint an
            // arbitrary string that dodges moderation; lands in the
            // server-owned vault so strict titles become wearable. Audited.
            const player = (0, _utils_js_1.safeName)(String(body.player ?? ''));
            const title = typeof body.title === 'string' ? body.title.trim() : '';
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if (!player || !title)
                return res.status(400).json({ error: 'Missing player or title.' });
            if (!reason)
                return res.status(400).json({ error: 'A reason is required to grant a title.' });
            if (!(0, _titles_registry_js_1.isKnownEarnedTitle)(title))
                return res.status(400).json({ error: 'Unknown title — only registered earned titles can be granted.' });
            const out = await (0, _lock_js_1.withKvLock)(`save:${player}`, async () => {
                const rec = await _storage_js_1.kv.get(`save:${player}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Save not found.' } };
                const earned = Array.isArray(char.earnedTitles) ? char.earnedTitles : [];
                const server = Array.isArray(char.serverTitles) ? char.serverTitles : [];
                if (server.includes(title))
                    return { status: 200, body: { ok: false, reason: 'already-granted' } };
                const updated = {
                    ...char,
                    serverTitles: [...server, title],
                    earnedTitles: earned.includes(title) ? earned : [...earned, title],
                };
                await _storage_js_1.kv.set(`save:${player}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                return { status: 200, body: { ok: true } };
            }, { failClosed: true });
            if (out.status === 200 && out.body.ok) {
                await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'title.grant', entityType: 'player', entityId: player, after: title, reason });
            }
            return res.status(out.status).json(out.body);
        }
        if (action === 'announce') {
            // Manual announcement (handoff Admin MVP). Importance allowlisted;
            // rides the normal announce() pipeline (news feed + chat lines +
            // webhook per importance). Audited.
            const importance = String(body.importance ?? 'high');
            const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
            const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
            if (!title || !message)
                return res.status(400).json({ error: 'Missing title or message.' });
            if (!['low', 'medium', 'high', 'mythic'].includes(importance))
                return res.status(400).json({ error: 'Bad importance.' });
            const posted = await (0, _announce_js_1.announce)({
                type: 'event', importance: importance,
                title, message,
                ...(body.player ? { player: (0, _utils_js_1.safeName)(String(body.player)) } : {}),
                ...(typeof body.village === 'string' && body.village ? { village: body.village } : {}),
                meta: { manual: true },
            });
            await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'announcement.create', after: { importance, title }, meta: { posted: !!posted } });
            return res.status(200).json({ ok: !!posted, announcement: posted });
        }
        // ── Era controls (docs/legacy-system-plan.md §14, admin-tunable) ─────
        if (action === 'era-view') {
            const [views, state] = await Promise.all([(0, _era_js_1.getEraViews)(), (0, _era_js_1.getEraState)()]);
            return res.status(200).json({ eras: views, overrides: state.overrides });
        }
        if (action === 'era-set-status') {
            const eraId = String(body.eraId ?? '');
            const status = String(body.status ?? '');
            const def = _era_js_1.ERA_BY_ID.get(eraId);
            if (!def)
                return res.status(400).json({ error: 'Unknown era.' });
            if (!['locked', 'admin_available', 'milestone_active', 'unlocked'].includes(status)) {
                return res.status(400).json({ error: 'Bad status.' });
            }
            await (0, _lock_js_1.withKvLock)(_era_js_1.ERA_STATE_KEY, async () => {
                const state = await (0, _era_js_1.getEraState)();
                state.overrides[eraId] = { ...state.overrides[eraId], status: status };
                await _storage_js_1.kv.set(_era_js_1.ERA_STATE_KEY, state);
            }, { failClosed: true });
            await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'era.set-status', entityType: 'era', entityId: eraId, after: status });
            return res.status(200).json({ ok: true });
        }
        if (action === 'era-set-milestone') {
            const eraId = String(body.eraId ?? '');
            const metric = String(body.metric ?? '');
            const required = Math.floor(num(body.required));
            const def = _era_js_1.ERA_BY_ID.get(eraId);
            if (!def)
                return res.status(400).json({ error: 'Unknown era.' });
            if (!def.milestones.some((m) => m.metric === metric))
                return res.status(400).json({ error: 'Unknown metric for this era.' });
            if (!Number.isFinite(required) || required < 0)
                return res.status(400).json({ error: 'Bad required value (0 waives the milestone).' });
            await (0, _lock_js_1.withKvLock)(_era_js_1.ERA_STATE_KEY, async () => {
                const state = await (0, _era_js_1.getEraState)();
                const prev = state.overrides[eraId] ?? {};
                state.overrides[eraId] = {
                    ...prev,
                    milestoneOverrides: { ...prev.milestoneOverrides, [metric]: required },
                };
                await _storage_js_1.kv.set(_era_js_1.ERA_STATE_KEY, state);
            }, { failClosed: true });
            await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'era.set-milestone', entityType: 'era', entityId: eraId, after: { metric, required } });
            // Lowering a floor may complete the era right away.
            await (0, _era_js_1.checkEraUnlocks)();
            return res.status(200).json({ ok: true });
        }
        if (action === 'era-force-unlock') {
            const eraId = String(body.eraId ?? '');
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            const def = _era_js_1.ERA_BY_ID.get(eraId);
            if (!def)
                return res.status(400).json({ error: 'Unknown era.' });
            if (!reason)
                return res.status(400).json({ error: 'A reason is required to force an era unlock.' });
            const player = body.player ? (0, _utils_js_1.safeName)(String(body.player)) : '';
            const did = await (0, _era_js_1.unlockEra)(def, player ? { player, village: typeof body.village === 'string' ? body.village : undefined, ts: Date.now() } : null, 'admin');
            await (0, _audit_js_1.recordAudit)({ actor: 'admin', domain: 'legacy', action: 'era.force-unlock', entityType: 'era', entityId: eraId, reason, meta: { credited: player || null, applied: did } });
            return res.status(200).json({ ok: true, applied: did });
        }
        if (action === 'hall-correct') {
            const entryId = Math.floor(num(body.entryId));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if (!entryId)
                return res.status(400).json({ error: 'Missing entryId.' });
            if (!reason)
                return res.status(400).json({ error: 'A reason is required for hall corrections.' });
            const status = typeof body.status === 'string' ? body.status : undefined;
            if (status && !['active', 'corrected', 'revoked', 'hidden'].includes(status)) {
                return res.status(400).json({ error: 'Bad status.' });
            }
            const patch = {};
            if (status)
                patch.status = status;
            if (typeof body.correctionNote === 'string')
                patch.correctionNote = body.correctionNote.slice(0, 300);
            const updated = await (0, _announce_js_1.updateHallEntry)(entryId, patch);
            if (!updated)
                return res.status(404).json({ error: 'Entry not found.' });
            await (0, _audit_js_1.recordAudit)({
                actor: 'admin', domain: 'legacy', action: 'hall.correct',
                entityType: 'hall-entry', entityId: String(entryId), after: patch, reason,
            });
            return res.status(200).json({ ok: true, entry: updated });
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Contended — please retry.' });
        }
        console.error('[admin/legacy]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
