import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
    savedCurrentSector,
} from './_mission-progress-receipt.js';
import { huntMissionById } from './_mission-catalog.js';
import {
    clampHuntQuality,
    deterministicHuntAmbush,
    huntRequiredTracks,
    serverHuntSign,
    serverHuntTrailSector,
} from './_hunt-trail.js';
import type { HuntTrailState } from './_world-ai-fight.js';
import { utcDateKey } from './_progress.js';

const HUNT_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

function trailMap(character: Record<string, unknown>): Record<string, HuntTrailState> {
    return character.serverHuntTrails && typeof character.serverHuntTrails === 'object' && !Array.isArray(character.serverHuntTrails)
        ? { ...(character.serverHuntTrails as Record<string, HuntTrailState>) }
        : {};
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function progressMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, raw]) => [key, Math.max(0, Math.floor(Number(raw) || 0))]));
}

function publicState(state: HuntTrailState | null, playerName: string, missionId: string) {
    const mission = huntMissionById(missionId);
    if (!state || !mission) return null;
    const requiredTracks = huntRequiredTracks(mission);
    const progress = Math.max(0, Math.min(requiredTracks - 1, Math.floor(state.progress)));
    return {
        missionId,
        runId: state.runId,
        progress,
        requiredTracks,
        quality: clampHuntQuality(state.quality),
        ready: progress >= requiredTracks - 1,
        sector: state.packPending === true && state.packSettled !== true && state.lastDecision
            ? state.lastDecision.sector
            : serverHuntTrailSector(mission, progress, playerName),
        sign: progress < requiredTracks - 1 ? serverHuntSign(mission.id, progress, playerName) : null,
        decisionId: state.decisionId,
        packPending: state.packPending === true,
        packSettled: state.packSettled === true,
        targetDefeated: state.targetDefeated === true,
        claimable: state.targetDefeated === true,
    };
}

function requiredHunterRank(levelReq: number): number {
    if (levelReq >= 70) return 4;
    if (levelReq >= 50) return 3;
    if (levelReq >= 30) return 2;
    if (levelReq >= 15) return 1;
    return 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const missionId = typeof body.missionId === 'string' ? body.missionId.trim().slice(0, 96) : '';
        const action = typeof body.action === 'string' ? body.action : '';
        const mission = huntMissionById(missionId);
        if (!playerName || !mission) return res.status(400).json({ error: 'Invalid player or hunt contract.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only manage your own hunt.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `hunt-trail-${action}`, 40, 60_000, identity.name))) return;

        if (!['accept', 'state', 'choose', 'abandon'].includes(action)) {
            return res.status(400).json({ error: 'Unknown hunt-trail action.' });
        }

        const out = await mutatePlayerSave<Record<string, unknown>>(playerName, async ({ record, character }) => {
            const acceptedIds = stringList(record.acceptedMissionIds);
            const missionProgress = progressMap(record.missionProgress);
            const trails = trailMap(character);
            const existing = trails[missionId] ?? null;
            const claimedServerMissions = Array.isArray(character.claimedServerMissions)
                ? character.claimedServerMissions.map(String)
                : [];
            const claimedToday = claimedServerMissions.includes(`${utcDateKey()}:hunt:${missionId}`);
            if (claimedToday) {
                delete trails[missionId];
                const nextAccepted = acceptedIds.filter((id) => id !== missionId);
                const nextProgress = { ...missionProgress, [missionId]: 0 };
                const changed = acceptedIds.includes(missionId) || existing !== null || missionProgress[missionId] !== 0;
                return {
                    ok: true as const,
                    character: { ...character, serverHuntTrails: trails },
                    recordPatch: { acceptedMissionIds: nextAccepted, missionProgress: nextProgress },
                    value: {
                        state: null,
                        acceptedMissionIds: nextAccepted,
                        missionProgress: nextProgress,
                        claimedToday: true,
                        resetReceipt: true,
                        replayed: true,
                    },
                    write: changed,
                };
            }

            if (action === 'state') {
                // Rollout recovery: old accepted hunts predate serverHuntTrails.
                // Preserve the accepted contract, but never import its historical
                // client-owned progress/quality. Eligibility is rechecked before
                // a neutral, server-owned trail is created.
                if (acceptedIds.includes(missionId) && !existing) {
                    if (Math.max(1, Math.floor(Number(character.level) || 1)) < mission.levelReq) {
                        return { ok: false as const, status: 409, error: 'This hunt is above your current level.' };
                    }
                    if (Math.max(0, Math.floor(Number(character.hunterRank) || 0)) < requiredHunterRank(mission.levelReq)) {
                        return { ok: false as const, status: 409, error: 'Your Hunter Rank is too low for this contract.' };
                    }
                    const recovered: HuntTrailState = {
                        missionId,
                        runId: randomUUID().replace(/-/g, ''),
                        progress: 0,
                        quality: 0,
                        acceptedAt: Date.now(),
                        receiptResetPending: true,
                    };
                    trails[missionId] = recovered;
                    const nextProgress = { ...missionProgress, [missionId]: 0 };
                    return {
                        ok: true as const,
                        character: { ...character, serverHuntTrails: trails },
                        recordPatch: { missionProgress: nextProgress },
                        value: { state: publicState(recovered, playerName, missionId), acceptedMissionIds: acceptedIds, missionProgress: nextProgress, resetReceipt: true, migrated: true },
                    };
                }
                return {
                    ok: true as const,
                    character,
                    value: { state: acceptedIds.includes(missionId) ? publicState(existing, playerName, missionId) : null, acceptedMissionIds: acceptedIds, missionProgress, ...(existing?.receiptResetPending ? { resetReceipt: true } : {}) },
                    write: false,
                };
            }

            if (action === 'accept') {
                if (acceptedIds.includes(missionId) && existing) {
                    return {
                        ok: true as const,
                        character,
                        value: { state: publicState(existing, playerName, missionId), acceptedMissionIds: acceptedIds, missionProgress, ...(existing.progress === 0 && !existing.lastDecision ? { resetReceipt: true } : {}) },
                        write: false,
                    };
                }
                if (Math.max(1, Math.floor(Number(character.level) || 1)) < mission.levelReq) {
                    return { ok: false as const, status: 409, error: 'This hunt is above your current level.' };
                }
                if (Math.max(0, Math.floor(Number(character.hunterRank) || 0)) < requiredHunterRank(mission.levelReq)) {
                    return { ok: false as const, status: 409, error: 'Your Hunter Rank is too low for this contract.' };
                }
                const state: HuntTrailState = {
                    missionId,
                    runId: randomUUID().replace(/-/g, ''),
                    progress: 0,
                    quality: 0,
                    acceptedAt: Date.now(),
                };
                trails[missionId] = state;
                const nextAccepted = acceptedIds.includes(missionId) ? acceptedIds : [...acceptedIds, missionId];
                const nextProgress = { ...missionProgress, [missionId]: 0 };
                return {
                    ok: true as const,
                    character: { ...character, serverHuntTrails: trails },
                    recordPatch: { acceptedMissionIds: nextAccepted, missionProgress: nextProgress },
                    value: { state: publicState(state, playerName, missionId), acceptedMissionIds: nextAccepted, missionProgress: nextProgress, resetReceipt: true },
                };
            }

            if (action === 'abandon') {
                delete trails[missionId];
                const nextAccepted = acceptedIds.filter((id) => id !== missionId);
                const nextProgress = { ...missionProgress, [missionId]: 0 };
                return {
                    ok: true as const,
                    character: { ...character, serverHuntTrails: trails },
                    recordPatch: { acceptedMissionIds: nextAccepted, missionProgress: nextProgress },
                    value: { state: null, acceptedMissionIds: nextAccepted, missionProgress: nextProgress, resetReceipt: true },
                };
            }

            if (!acceptedIds.includes(missionId) || !existing) {
                return { ok: false as const, status: 409, error: 'Accept this hunt before tracking it.' };
            }
            if (existing.packPending && !existing.packSettled) {
                return { ok: false as const, status: 409, error: 'Settle the pack ambush before reading another sign.' };
            }
            const requestedSector = Math.floor(Number(body.sector));
            const currentSector = savedCurrentSector(record);
            const expectedSector = serverHuntTrailSector(mission, existing.progress, playerName);
            const choiceId = typeof body.choiceId === 'string' ? body.choiceId.trim().slice(0, 32) : '';
            const last = existing.lastDecision;
            // Only an advancing decision can be replayed. A non-advancing choice
            // deliberately leaves the same sign live, so treating every identical
            // choice as a replay would make that route impossible to retry.
            // Once an ambush has settled, echo the durable decision with ambush
            // suppressed: a lost choose response may still advance/travel, but it
            // can never relaunch the already-settled pack.
            const replayableLast = last && (last.ambush || last.progress > last.stage);
            if (replayableLast && last.sector === requestedSector && last.choiceId === choiceId
                && (existing.packPending || existing.packSettled || requestedSector !== expectedSector)) {
                const settledAmbush = last.ambush && existing.packSettled === true && existing.packPending !== true;
                return {
                    ok: true as const,
                    character,
                    value: { ...last, ...(settledAmbush ? { ambush: false } : {}), state: publicState(existing, playerName, missionId), acceptedMissionIds: acceptedIds, missionProgress, replayed: true, ...(last.progress > last.stage ? { trackEvidenceId: last.id } : {}) },
                    write: false,
                };
            }
            if (!Number.isFinite(requestedSector) || requestedSector !== currentSector || requestedSector !== expectedSector) {
                return { ok: false as const, status: 409, error: 'The hunt sign is not in your current sector.' };
            }
            const requiredTracks = huntRequiredTracks(mission);
            const stage = Math.max(0, Math.floor(existing.progress));
            if (stage >= requiredTracks - 1) return { ok: false as const, status: 409, error: 'The target is already found.' };
            const sign = serverHuntSign(missionId, stage, playerName);
            const choice = sign.choices.find((entry) => entry.id === choiceId);
            if (!choice) return { ok: false as const, status: 409, error: 'That choice does not belong to this sign.' };

            const decisionId = `hunt_${existing.runId}_${stage}_${choice.id}`.slice(0, 96);
            const ambush = deterministicHuntAmbush(playerName, existing.runId, stage, choice.id, choice.outcome.ambushChance);
            const nextProgressValue = choice.outcome.advances ? Math.min(requiredTracks - 1, stage + 1) : stage;
            const quality = clampHuntQuality(existing.quality + choice.outcome.quality);
            const nextSector = serverHuntTrailSector(mission, nextProgressValue, playerName);
            const lastDecision = { id: decisionId, sector: requestedSector, stage, choiceId, ambush, progress: nextProgressValue, quality, nextSector, decidedAt: Date.now() };
            const state: HuntTrailState = {
                ...existing,
                progress: nextProgressValue,
                quality,
                decisionId: ambush ? decisionId : undefined,
                packPending: ambush,
                packSettled: false,
                lastDecision,
            };

            trails[missionId] = state;
            const nextProgress = { ...missionProgress, [missionId]: nextProgressValue };
            return {
                ok: true as const,
                character: { ...character, serverHuntTrails: trails },
                recordPatch: { missionProgress: nextProgress },
                value: { ...lastDecision, decisionId, state: publicState(state, playerName, missionId), acceptedMissionIds: acceptedIds, missionProgress: nextProgress, ...(choice.outcome.advances ? { trackEvidenceId: decisionId } : {}) },
            };
        });

        if (!out.ok) return res.status(out.status).json({ ok: false, error: out.error });
        const receiptKey = missionProgressReceiptKey(playerName, missionId);
        let responseCharacter = out.character;
        let responseSaveVersion = out._saveVersion;
        try {
            const value = out.value as { resetReceipt?: boolean; trackEvidenceId?: string };
            if (value.resetReceipt) {
                // The save/trail commit lands first. Claim-mission requires the
                // accepted id under the same save lock, so a stale receipt cannot
                // pay an abandoned run during this cleanup window.
                await kv.del(receiptKey);
                // A migrated legacy hunt keeps a durable cleanup marker until the
                // stale receipt delete succeeds. Clear it only afterwards so a
                // 503/lost response retries the delete, but future state reads do
                // not erase evidence produced by this new authoritative run.
                const cleared = await mutatePlayerSave<Record<string, unknown>>(playerName, async ({ character }) => {
                    const trails = trailMap(character);
                    const trail = trails[missionId];
                    if (!trail?.receiptResetPending) {
                        return { ok: true as const, character, value: {}, write: false };
                    }
                    trails[missionId] = { ...trail, receiptResetPending: false };
                    return { ok: true as const, character: { ...character, serverHuntTrails: trails }, value: {} };
                });
                if (cleared.ok) {
                    responseCharacter = cleared.character;
                    responseSaveVersion = cleared._saveVersion;
                }
            } else if (value.trackEvidenceId) {
                await withKvLock(receiptKey, async () => {
                    const current = cleanMissionProgressReceipt(await kv.get(receiptKey));
                    const receipt = applyMissionProgressEvent(current, {
                        playerName,
                        missionId,
                        missionType: 'hunt',
                        kind: 'hunt-track',
                        exploreTarget: huntRequiredTracks(mission),
                        raidTarget: 0,
                        evidenceId: value.trackEvidenceId!,
                    });
                    await kv.set(receiptKey, receipt, { ex: HUNT_RECEIPT_TTL_SECONDS });
                }, { failClosed: true });
            }
        } catch (error) {
            console.error('[missions/hunt-trail receipt]', safeLogValue(error));
            return res.status(503).json({ ok: false, retryable: true, error: 'The Guild ledger is still syncing. Retry the same action.' });
        }
        const claimedToday = (out.value as { claimedToday?: boolean }).claimedToday === true;
        return res.status(200).json({
            ok: true,
            ...out.value,
            ...(claimedToday ? { reason: 'already-claimed-today' } : {}),
            character: responseCharacter,
            _saveVersion: responseSaveVersion,
        });
    } catch (error) {
        console.error('[missions/hunt-trail]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
