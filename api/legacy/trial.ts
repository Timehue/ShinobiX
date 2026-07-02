import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { getLegacyStats, appendLegacyEvent, legacyEnabled } from '../_legacy-track.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';
import {
    legacyTrialKey, legacyAcceptedKey, trialObjectivesFor, trialProgress, nextTrialKind,
    type LegacyTrial, type CharacterLegacy,
} from '../_legacy-core.js';
import { announce, addHallEntry } from '../_announce.js';
import { recordAudit } from '../_audit.js';

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

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'Legacies are not awake yet.' });

    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(isGet ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }

        if (isGet) {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-trial-get', 20, 60_000, identity.name))) return;
            const [trial, rec] = await Promise.all([
                kv.get<LegacyTrial>(legacyTrialKey(playerName)),
                kv.get<Record<string, unknown>>(`save:${playerName}`),
            ]);
            const legacy = ((rec?.character as Record<string, unknown> | undefined)?.legacy ?? null) as CharacterLegacy | null;
            if (!trial) return res.status(200).json({ trial: null, legacy });
            const stats = await getLegacyStats(playerName);
            return res.status(200).json({ trial: { ...trial, objectives: trialProgress(trial, stats) }, legacy });
        }

        if (req.method !== 'POST') return res.status(405).end();
        const action = typeof body.action === 'string' ? body.action : '';
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `legacy-trial-${action}`, 10, 60_000, identity.name))) return;

        // ── START: seal baselines for the next stage's trial ────────────────
        if (action === 'start') {
            const out = await withKvLock<{ status: number; body: unknown }>(legacyTrialKey(playerName), async () => {
                const existing = await kv.get<LegacyTrial>(legacyTrialKey(playerName));
                if (existing) return { status: 200, body: { ok: false, reason: 'busy' } };

                const sealed = await kv.get<{ legacyId: string }>(legacyAcceptedKey(playerName));
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                const legacy = (char?.legacy ?? null) as CharacterLegacy | null;
                if (!sealed || !legacy || legacy.legacyId !== sealed.legacyId) {
                    return { status: 200, body: { ok: false, reason: 'no-legacy' } };
                }
                const def = LEGACY_BY_ID.get(legacy.legacyId);
                const kind = nextTrialKind(legacy.stage);
                if (!def || !kind) return { status: 200, body: { ok: false, reason: 'complete' } };

                const stats = await getLegacyStats(playerName, char);
                const objectives = trialObjectivesFor(def, kind);
                const trial: LegacyTrial = {
                    legacyId: legacy.legacyId, kind, startedAt: Date.now(), attempt: 1,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await kv.set(legacyTrialKey(playerName), trial);
                await appendLegacyEvent(playerName, { type: 'trial-started', key: `${legacy.legacyId}:${kind}` });
                return { status: 200, body: { ok: true, trial } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        // ── COMPLETE: verify deltas, advance stage, grant title ─────────────
        if (action === 'complete') {
            const out = await withKvLock<{ status: number; body: unknown }>(legacyTrialKey(playerName), async () => {
                const trial = await kv.get<LegacyTrial>(legacyTrialKey(playerName));
                if (!trial) return { status: 200, body: { ok: false, reason: 'none' } };
                const def = LEGACY_BY_ID.get(trial.legacyId);
                if (!def) return { status: 200, body: { ok: false, reason: 'none' } };

                const stats = await getLegacyStats(playerName);
                const progress = trialProgress(trial, stats);
                if (!progress.every((p) => p.done)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', objectives: progress } };
                }

                const now = Date.now();
                const saveOut = await withKvLock<CharacterLegacy | null>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const char = (rec?.character ?? null) as Record<string, unknown> | null;
                    const legacy = (char?.legacy ?? null) as CharacterLegacy | null;
                    if (!rec || !char || !legacy || legacy.legacyId !== trial.legacyId) return null;

                    const next: CharacterLegacy = { ...legacy };
                    if (trial.kind === 'awaken' && legacy.stage === 1) {
                        next.stage = 2;
                        next.awakenedAt = now;
                        next.titles = [...new Set([...(legacy.titles ?? []), def.title])];
                    } else if (trial.kind === 'bind' && legacy.stage === 2) {
                        next.stage = 3;
                        next.boundAt = now;
                    } else {
                        return null; // stale trial for a stage that already moved
                    }
                    const earned = Array.isArray(char.earnedTitles) ? (char.earnedTitles as string[]) : [];
                    const updated = {
                        ...char,
                        legacy: next,
                        earnedTitles: trial.kind === 'awaken' ? [...new Set([...earned, def.title])] : earned,
                    };
                    await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
                    return next;
                }, { failClosed: true });

                if (!saveOut) return { status: 200, body: { ok: false, reason: 'none' } };
                await kv.del(legacyTrialKey(playerName));
                await appendLegacyEvent(playerName, { type: 'trial-complete', key: `${trial.legacyId}:${trial.kind}` });
                await recordAudit({
                    actor: playerName, domain: 'legacy', action: `trial.${trial.kind}.complete`,
                    entityType: 'legacy', entityId: trial.legacyId, meta: { stage: saveOut.stage },
                });

                // Announcement matrix (design handoff): legendary awakenings are
                // 'high'; mythic moments are 'mythic' + a permanent Hall entry.
                if (trial.kind === 'awaken') {
                    const rec2 = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const village = String((rec2?.character as Record<string, unknown> | undefined)?.village ?? '') || undefined;
                    if (def.rarity === 'legendary') {
                        await announce({
                            type: 'legacy_awakening', importance: 'high',
                            title: 'LEGENDARY LEGACY AWAKENED',
                            message: `${playerName} has completed the Trial of the ${def.title}. ${def.flavor}`,
                            player: playerName, village, legacyId: def.id,
                        });
                    } else if (def.rarity === 'mythic') {
                        await announce({
                            type: 'mythic_legacy', importance: 'mythic',
                            title: 'MYTHIC LEGACY AWAKENED',
                            message: `${playerName} has awakened the ${def.name}. The world will remember.`,
                            player: playerName, village, legacyId: def.id,
                        });
                        await addHallEntry({
                            entryType: 'mythic_legacy',
                            title: def.name,
                            description: `Awakened by ${playerName}${village ? ` of ${village}` : ''}. ${def.flavor}`,
                            player: playerName, village, legacyId: def.id, rarity: def.rarity,
                        }, { nxKey: `mythic-legacy:${def.id}:${playerName}` });
                    } else if (def.rarity === 'rare') {
                        await announce({
                            type: 'legacy_awakening', importance: 'medium',
                            title: 'A Legacy Awakens',
                            message: `${playerName} has awakened the ${def.name}.`,
                            player: playerName, village, legacyId: def.id,
                        });
                    }
                }
                return { status: 200, body: { ok: true, legacy: saveOut, title: trial.kind === 'awaken' ? def.title : null } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Trial busy — please retry.' });
        }
        console.error('[legacy/trial]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
