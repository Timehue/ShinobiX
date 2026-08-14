import { randomUUID } from 'node:crypto';

export type ServerFieldMissionRun = {
    missionId: string;
    runId: string;
    acceptedAt: number;
};

function cleanRunId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{16,96}$/.test(id) ? id : '';
}

export function newFieldMissionRun(missionId: string, now = Date.now()): ServerFieldMissionRun {
    return {
        missionId,
        runId: randomUUID().replace(/-/g, ''),
        acceptedAt: Math.max(1, Math.floor(now)),
    };
}

export function serverFieldMissionRun(
    character: Record<string, unknown> | null | undefined,
    missionId: string,
): ServerFieldMissionRun | null {
    const runs = character?.serverFieldMissionRuns;
    if (!runs || typeof runs !== 'object' || Array.isArray(runs)) return null;
    const raw = (runs as Record<string, unknown>)[missionId];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const runId = cleanRunId(value.runId);
    const acceptedAt = Math.floor(Number(value.acceptedAt));
    if (value.missionId !== missionId || !runId || !Number.isSafeInteger(acceptedAt) || acceptedAt <= 0) return null;
    return { missionId, runId, acceptedAt };
}

export function withServerFieldMissionRun(
    character: Record<string, unknown>,
    run: ServerFieldMissionRun,
): Record<string, unknown> {
    const runs = character.serverFieldMissionRuns && typeof character.serverFieldMissionRuns === 'object' && !Array.isArray(character.serverFieldMissionRuns)
        ? character.serverFieldMissionRuns as Record<string, unknown>
        : {};
    return { ...character, serverFieldMissionRuns: { ...runs, [run.missionId]: run } };
}

export function withoutServerFieldMissionRun(
    character: Record<string, unknown>,
    missionId: string,
): Record<string, unknown> {
    const runs = character.serverFieldMissionRuns && typeof character.serverFieldMissionRuns === 'object' && !Array.isArray(character.serverFieldMissionRuns)
        ? character.serverFieldMissionRuns as Record<string, unknown>
        : {};
    if (!(missionId in runs)) return character;
    const next = { ...runs };
    delete next[missionId];
    return { ...character, serverFieldMissionRuns: next };
}
