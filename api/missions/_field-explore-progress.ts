import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { fieldMissionById } from './_mission-catalog.js';
import { serverFieldMissionRun } from './_field-trail.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressReceipt,
    missionProgressReceiptKey,
    savedAcceptedMissionIds,
} from './_mission-progress-receipt.js';

const PROGRESS_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;

export function fieldExploreEvidenceId(requestId: string): string {
    const direct = `worldexplore_${requestId}`;
    return direct.length <= 96
        ? direct
        : `worldexplore_${createHash('sha256').update(requestId).digest('hex')}`;
}

/** Credit every exact, active, accepted field run targeting this sector. This
 * runs from the server explore receipt so a stale second device cannot omit a
 * contract merely because its local acceptedMissionIds mirror is old. */
export async function creditFieldExploreProgress(params: {
    playerName: string;
    requestId: string;
    sector: number;
    proofAt: number;
}): Promise<Array<{ missionId: string; runId: string; exploreCount: number; replayed: boolean }>> {
    const record = await kv.get<Record<string, unknown>>(`save:${params.playerName}`);
    const character = record?.character as Record<string, unknown> | undefined;
    if (!record || !character) return [];
    const results: Array<{ missionId: string; runId: string; exploreCount: number; replayed: boolean }> = [];
    for (const missionId of savedAcceptedMissionIds(record)) {
        const mission = fieldMissionById(missionId);
        const run = serverFieldMissionRun(character, missionId);
        if (!mission || !run || Math.floor(Number(mission.targetSector)) !== params.sector
            || params.proofAt < run.acceptedAt) continue;
        const key = missionProgressReceiptKey(params.playerName, missionId);
        const evidenceId = fieldExploreEvidenceId(params.requestId);
        const result = await withKvLock(key, async () => {
            const existing = cleanMissionProgressReceipt(await kv.get(key));
            const replayed = existing?.runId === run.runId && existing.evidenceIds.includes(evidenceId);
            const next = replayed ? existing! : applyMissionProgressEvent(existing, {
                playerName: params.playerName,
                missionId,
                missionType: 'field',
                kind: 'field-explore',
                exploreTarget: Math.floor(Number(mission.exploreCount) || 0),
                raidTarget: Math.floor(Number(mission.raidCount) || 0),
                evidenceId,
                runId: run.runId,
                now: params.proofAt,
            });
            if (!replayed) await kv.set(key, next, { ex: PROGRESS_RECEIPT_TTL_SECONDS });
            return { next, replayed };
        }, { failClosed: true });
        results.push({ missionId, runId: run.runId, exploreCount: result.next.exploreCount, replayed: result.replayed });
    }
    return results;
}
