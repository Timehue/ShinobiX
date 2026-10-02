import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { legacyEnabled } from '../_legacy-track.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';
import { getEraState, effectiveStatus, ERA_BY_ID } from '../_era.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { LockContendedError } from '../_lock.js';
import { ERA_CHAPTERS, ERA_CAMPAIGN_ORDER, eraChapterProgress, type EraJourney, type EraJourneys } from '../../shared/era-chapters.js';
import { readEraJourneys } from '../_era-campaign.js';
export { readEraJourneys } from '../_era-campaign.js';

/** Reject damaged authority rather than interpreting missing baselines as zero. */
function campaignBlock(id: string, journeys: EraJourneys, character: Record<string, unknown>): string | undefined {
    const index = ERA_CAMPAIGN_ORDER.findIndex(eraId => eraId === id);
    if (index > 0) {
        const previous = journeys[ERA_CAMPAIGN_ORDER[index - 1]!];
        if (previous?.version !== 2 || !previous.completedAt) return `Complete the Era ${['I', 'II', 'III', 'IV'][index - 1]} campaign first.`;
    }
    const admission = ERA_CHAPTERS.find(chapter => chapter.eraId === id)?.admission;
    if (!admission) return undefined;
    const missing: string[] = [];
    const level = Number(character.level);
    if (!Number.isFinite(level) || level < admission.level) missing.push(`reach level ${admission.level}`);
    const legacy = character.legacy as { legacyId?: string; stage?: number } | undefined;
    if (!legacy || !LEGACY_BY_ID.has(legacy.legacyId ?? '') || !Number.isInteger(legacy.stage) || legacy.stage! < admission.legacyStage || legacy.stage! > 5) {
        missing.push(`bring your chosen Legacy to Stage ${admission.legacyStage === 4 ? 'IV (Proven)' : 'V (summit)'} at any rarity`);
    }
    return missing.length ? `Before accepting this campaign, ${missing.join(' and ')}.` : undefined;
}

/** GET personal fresh progress; POST start/complete. Only server stats count.
 * Journey completion and its cosmetic title commit in the SAME save write. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'World chapters are unavailable.' });
    try {
        const body = req.method === 'GET' ? req.query : typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only view your own world chapters.' });
        if (!(await enforceRateLimitKv(req, res, 'era-journey', 30, 60_000, identity.admin ? playerName : identity.name))) return;
        // Read authority directly: an unavailable state read must not expose a
        // chapter using a silently defaulted admin status.
        const state = await getEraState();
        const available = (id: string) => effectiveStatus(ERA_BY_ID.get(id)!, state.overrides[id]) === 'unlocked';
        if (req.method === 'GET') {
            const record = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
            if (!record?.character) return res.status(404).json({ error: 'Player save not found.' });
            const journeys = readEraJourneys(record.character.eraJourneys);
            res.setHeader('Cache-Control', 'private, no-store');
            return res.status(200).json({ chapters: ERA_CHAPTERS.map(chapter => {
                const blockedReason = available(chapter.eraId) ? campaignBlock(chapter.eraId, journeys, record.character!) : undefined;
                return { ...eraChapterProgress(chapter, journeys[chapter.eraId], {}, available(chapter.eraId) && !blockedReason), ...(blockedReason ? { blockedReason } : {}) };
            }) });
        }
        const chapter = ERA_CHAPTERS.find(item => item.eraId === body.eraId);
        if (!chapter || !['start', 'complete'].includes(body.action)) return res.status(400).json({ error: 'Unknown chapter or action.' });
        if (!available(chapter.eraId)) return res.status(409).json({ error: 'This chapter opens when the world unlocks its era.' });
        const result = await mutatePlayerSave(playerName, async ({ character }) => {
            const journeys = readEraJourneys(character.eraJourneys);
            const blockedReason = campaignBlock(chapter.eraId, journeys, character);
            if (blockedReason) return { ok: false as const, status: 409, error: blockedReason };
            const stats = {};
            const previous = journeys[chapter.eraId];
            let next = previous;
            if (body.action === 'start') {
                const route = chapter.routes.find(item => item.id === body.routeId);
                if (!route) return { ok: false as const, status: 400, error: 'Unknown investigation route.' };
                if (previous && previous.routeId !== route.id) return { ok: false as const, status: 409, error: 'Your chosen route is already recorded.' };
                const now = Date.now();
                next = previous?.version === 2 ? previous : { version: 2, routeId: route.id, startedAt: now, baselines: {}, stageIndex: 0, stageStartedAt: now,
                    stageCounts: {}, completedStages: [], proofReceipts: [], ...(previous?.completedAt ? { legacyCompletedAt: previous.completedAt } : {}) } satisfies EraJourney;
            } else {
                if (!previous) return { ok: false as const, status: 409, error: 'Choose an investigation route first.' };
                if (!eraChapterProgress(chapter, previous, stats, true).ready) return { ok: false as const, status: 409, error: 'Your campaign still needs fresh evidence and its examinations.' };
                next = previous.completedAt ? previous : { ...previous, completedAt: Date.now() };
            }
            const serverTitles = Array.isArray(character.serverTitles) ? character.serverTitles as string[] : [];
            const earnedTitles = Array.isArray(character.earnedTitles) ? character.earnedTitles as string[] : [];
            const completed = !!next?.completedAt;
            return {
                ok: true as const,
                character: { ...character, eraJourneys: { ...journeys, [chapter.eraId]: next },
                    ...(completed ? { serverTitles: serverTitles.includes(chapter.rewardTitle) ? serverTitles : [...serverTitles, chapter.rewardTitle], earnedTitles: earnedTitles.includes(chapter.rewardTitle) ? earnedTitles : [...earnedTitles, chapter.rewardTitle] } : {}) },
                write: next !== previous || (completed && (!serverTitles.includes(chapter.rewardTitle) || !earnedTitles.includes(chapter.rewardTitle))),
                value: { chapter: eraChapterProgress(chapter, next, stats, true), rewardTitle: completed ? chapter.rewardTitle : null },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'The Hall is busy. Please try again.' });
        console.error('[eras/journey]', error instanceof Error ? error.message : 'unknown error');
        return res.status(500).json({ error: 'The chapter record could not be sealed. Please try again.' });
    }
}
