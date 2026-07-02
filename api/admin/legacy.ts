import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { getLegacyStats, legacyStatsKey, legacyEventsKey, appendLegacyEvent, legacyEnabled, type LegacyEvent, type LegacyStats } from '../_legacy-track.js';
import { evaluateAllLegacies, getLegacyOverlay, LEGACY_OVERLAY_KEY, type LegacyOverlay } from '../_legacy-score.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';
import { legacyAcceptedKey, legacyTrialKey, type CharacterLegacy } from '../_legacy-core.js';
import { recordAudit } from '../_audit.js';
import { updateHallEntry } from '../_announce.js';

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

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(401).json({ error: 'Admin authentication required.' });
    if (!legacyEnabled()) return res.status(404).json({ error: 'ENABLE_LEGACY is not set.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';

        if (action === 'view' || action === 'recalc') {
            const player = safeName(String(body.player ?? ''));
            if (!player) return res.status(400).json({ error: 'Missing player.' });
            const rec = await kv.get<Record<string, unknown>>(`save:${player}`);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!char) return res.status(404).json({ error: 'Save not found.' });
            const stats = await getLegacyStats(player, char);
            const overlay = await getLegacyOverlay();
            const evals = evaluateAllLegacies(stats, {
                level: num(char.level), village: typeof char.village === 'string' ? char.village : null, overlay,
            });
            const [offer, trial, sealed, events] = await Promise.all([
                kv.get(`legacy:sage-offer:${player}`),
                kv.get(legacyTrialKey(player)),
                kv.get(legacyAcceptedKey(player)),
                kv.get<LegacyEvent[]>(legacyEventsKey(player)),
            ]);
            return res.status(200).json({
                player, stats,
                legacy: (char.legacy ?? null) as CharacterLegacy | null,
                sealed: sealed ?? null,
                offer: offer ?? null,
                trial: trial ?? null,
                events: Array.isArray(events) ? events.slice(0, 50) : [],
                eligible: evals.filter((e) => e.eligible),
                nearMisses: evals.filter((e) => !e.eligible && e.score >= 0.6).slice(0, 15),
            });
        }

        if (action === 'emergency-change') {
            const player = safeName(String(body.player ?? ''));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            const legacyId = body.legacyId === null ? null : String(body.legacyId ?? '');
            if (!player) return res.status(400).json({ error: 'Missing player.' });
            if (!reason) return res.status(400).json({ error: 'A reason is required for emergency corrections.' });
            if (legacyId !== null && !LEGACY_BY_ID.has(legacyId)) return res.status(400).json({ error: 'Unknown legacy.' });

            const out = await withKvLock<{ status: number; body: unknown }>(`legacy:accept:${player}`, async () => {
                const prev = await kv.get<{ legacyId: string }>(legacyAcceptedKey(player));
                const saveOk = await withKvLock<boolean>(`save:${player}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${player}`);
                    const char = (rec?.character ?? null) as Record<string, unknown> | null;
                    if (!rec || !char) return false;
                    const now = Date.now();
                    const legacy: CharacterLegacy | null = legacyId === null ? null : {
                        legacyId, stage: 1, acceptedAt: now, titles: [],
                    };
                    const updated: Record<string, unknown> = { ...char, legacy };
                    await kv.set(`save:${player}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                    return true;
                }, { failClosed: true });
                if (!saveOk) return { status: 404, body: { error: 'Save not found.' } };

                if (legacyId === null) {
                    await kv.del(legacyAcceptedKey(player));
                } else {
                    await kv.set(legacyAcceptedKey(player), { legacyId, ts: Date.now(), adminSet: true });
                }
                await kv.del(legacyTrialKey(player));
                await appendLegacyEvent(player, { type: 'admin-correction', key: legacyId ?? 'cleared', meta: { reason } });
                await recordAudit({
                    actor: 'admin', domain: 'legacy', action: 'legacy.emergency-change',
                    entityType: 'player', entityId: player,
                    before: prev?.legacyId ?? null, after: legacyId, reason,
                });
                return { status: 200, body: { ok: true, previous: prev?.legacyId ?? null, current: legacyId } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        if (action === 'get-overlay') {
            return res.status(200).json({ overlay: await getLegacyOverlay() });
        }

        if (action === 'set-overlay') {
            const overlay = (body.overlay ?? {}) as LegacyOverlay;
            if (typeof overlay !== 'object' || Array.isArray(overlay)) {
                return res.status(400).json({ error: 'Overlay must be an object.' });
            }
            const before = await getLegacyOverlay();
            await kv.set(LEGACY_OVERLAY_KEY, overlay);
            await recordAudit({
                actor: 'admin', domain: 'legacy', action: 'legacy.overlay-set',
                before, after: overlay,
            });
            return res.status(200).json({ ok: true });
        }

        if (action === 'reset-tracking') {
            // Testing tool: wipe a player's side-car counters (NOT their legacy).
            const player = safeName(String(body.player ?? ''));
            if (!player) return res.status(400).json({ error: 'Missing player.' });
            await kv.del(legacyStatsKey(player));
            await recordAudit({ actor: 'admin', domain: 'legacy', action: 'legacy.reset-tracking', entityType: 'player', entityId: player });
            return res.status(200).json({ ok: true });
        }

        if (action === 'hall-correct') {
            const entryId = Math.floor(num(body.entryId));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if (!entryId) return res.status(400).json({ error: 'Missing entryId.' });
            if (!reason) return res.status(400).json({ error: 'A reason is required for hall corrections.' });
            const status = typeof body.status === 'string' ? body.status : undefined;
            if (status && !['active', 'corrected', 'revoked', 'hidden'].includes(status)) {
                return res.status(400).json({ error: 'Bad status.' });
            }
            const patch: Record<string, unknown> = {};
            if (status) patch.status = status;
            if (typeof body.correctionNote === 'string') patch.correctionNote = body.correctionNote.slice(0, 300);
            const updated = await updateHallEntry(entryId, patch);
            if (!updated) return res.status(404).json({ error: 'Entry not found.' });
            await recordAudit({
                actor: 'admin', domain: 'legacy', action: 'hall.correct',
                entityType: 'hall-entry', entityId: String(entryId), after: patch, reason,
            });
            return res.status(200).json({ ok: true, entry: updated });
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Contended — please retry.' });
        }
        console.error('[admin/legacy]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
