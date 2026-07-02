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
