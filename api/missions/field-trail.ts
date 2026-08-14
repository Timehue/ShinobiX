import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeLogValue } from '../_safe-log.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { fieldMissionById, huntMissionById } from './_mission-catalog.js';
import { canPlayerReceiveMission, missionEligibilityFailureBody } from './_eligibility.js';
import { cleanMissionProgressReceipt, missionProgressReceiptKey } from './_mission-progress-receipt.js';
import { utcDateKey } from './_progress.js';
import {
    newFieldMissionRun,
    serverFieldMissionRun,
    withServerFieldMissionRun,
    withoutServerFieldMissionRun,
    type ServerFieldMissionRun,
} from './_field-trail.js';

type FieldTrailValue = {
    state: ServerFieldMissionRun | null;
    acceptedMissionIds: string[];
    missionProgress: Record<string, unknown>;
    replayed: boolean;
    migrated?: boolean;
    claimedToday?: boolean;
    cleanupReceipt?: boolean;
};

function strings(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function progressMap(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function projectRunProgress(
    playerName: string,
    missionId: string,
    run: ServerFieldMissionRun,
    fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const receipt = cleanMissionProgressReceipt(await kv.get(missionProgressReceiptKey(playerName, missionId)).catch(() => null));
    if (!receipt || receipt.runId !== run.runId) return fallback;
    return {
        ...fallback,
        [missionId]: receipt.exploreCount,
        [`${missionId}:raids`]: receipt.raidCount,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const missionId = typeof body.missionId === 'string' ? body.missionId.trim().slice(0, 80) : '';
        const action = body.action === 'accept' || body.action === 'state' || body.action === 'abandon'
            ? body.action
            : '';
        if (!playerName || !missionId || !action) return res.status(400).json({ error: 'Invalid field mission request.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your mission.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'field-trail', 40, 60_000, identity.name))) return;

        const mission = fieldMissionById(missionId);
        if (!mission || huntMissionById(missionId)) return res.status(404).json({ error: 'Field mission not found.' });

        const result = await mutatePlayerSave<FieldTrailValue>(playerName, async ({ record, character }) => {
            const accepted = strings(record.acceptedMissionIds);
            const progress = progressMap(record.missionProgress);
            const existing = serverFieldMissionRun(character, missionId);
            const isAccepted = accepted.includes(missionId);
            const claimedServerMissions = Array.isArray(character.claimedServerMissions)
                ? character.claimedServerMissions.map(String)
                : [];
            const claimedToday = claimedServerMissions.includes(`${utcDateKey()}:field:${missionId}`);
            if (claimedToday) {
                const nextAccepted = accepted.filter((id) => id !== missionId);
                const nextProgress = { ...progress, [missionId]: 0, [`${missionId}:raids`]: 0 };
                const nextCharacter = withoutServerFieldMissionRun(character, missionId);
                const changed = isAccepted || existing !== null
                    || progress[missionId] !== 0 || progress[`${missionId}:raids`] !== 0;
                return {
                    ok: true as const,
                    character: nextCharacter,
                    recordPatch: { acceptedMissionIds: nextAccepted, missionProgress: nextProgress },
                    value: {
                        state: null,
                        acceptedMissionIds: nextAccepted,
                        missionProgress: nextProgress,
                        replayed: true,
                        claimedToday: true,
                        cleanupReceipt: true,
                    },
                    write: changed,
                };
            }

            if (action === 'abandon') {
                const nextAccepted = accepted.filter((id) => id !== missionId);
                const nextProgress = { ...progress, [missionId]: 0, [`${missionId}:raids`]: 0 };
                const nextCharacter = withoutServerFieldMissionRun(character, missionId);
                const changed = isAccepted || existing !== null || progress[missionId] !== 0 || progress[`${missionId}:raids`] !== 0;
                return {
                    ok: true as const,
                    character: nextCharacter,
                    recordPatch: { acceptedMissionIds: nextAccepted, missionProgress: nextProgress },
                    value: { state: null, acceptedMissionIds: nextAccepted, missionProgress: nextProgress, replayed: !changed },
                    write: changed,
                };
            }

            if (existing && isAccepted) {
                const projectedProgress = await projectRunProgress(playerName, missionId, existing, progress);
                return {
                    ok: true as const,
                    character,
                    value: { state: existing, acceptedMissionIds: accepted, missionProgress: projectedProgress, replayed: true },
                    write: false as const,
                };
            }
            if (action === 'state' && !isAccepted) {
                return {
                    ok: true as const,
                    character,
                    value: { state: null, acceptedMissionIds: accepted, missionProgress: progress, replayed: true },
                    write: false as const,
                };
            }

            const eligibility = canPlayerReceiveMission(character, mission);
            if (!eligibility.ok) {
                return { ok: false as const, status: 403, error: JSON.stringify(missionEligibilityFailureBody(eligibility)) };
            }
            // `state` self-heals accepted legacy saves, but never trusts their
            // client-owned progress. A new run starts from zero with a unique
            // server nonce, making every old KV receipt ineligible.
            const run = newFieldMissionRun(missionId);
            const nextAccepted = isAccepted ? accepted : [...accepted, missionId];
            const nextProgress = { ...progress, [missionId]: 0, [`${missionId}:raids`]: 0 };
            return {
                ok: true as const,
                character: withServerFieldMissionRun(character, run),
                recordPatch: { acceptedMissionIds: nextAccepted, missionProgress: nextProgress },
                value: {
                    state: run,
                    acceptedMissionIds: nextAccepted,
                    missionProgress: nextProgress,
                    replayed: false,
                    ...(action === 'state' ? { migrated: true } : {}),
                },
            };
        });
        if (!result.ok) {
            let details: Record<string, unknown> = {};
            try { details = JSON.parse(result.error) as Record<string, unknown>; } catch { /* plain error */ }
            return res.status(result.status).json({ error: details.error ?? result.error, ...details });
        }
        if (result.value.cleanupReceipt) {
            await kv.del(missionProgressReceiptKey(playerName, missionId)).catch(() => undefined);
        }
        return res.status(200).json({
            ok: true,
            ...result.value,
            ...(result.value.claimedToday ? { reason: 'already-claimed-today' } : {}),
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error('[missions/field-trail]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
