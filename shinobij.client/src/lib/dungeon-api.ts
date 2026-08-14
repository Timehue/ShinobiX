import type { Character } from '../types/character';

export class DungeonProbeError extends Error {
    readonly retryable: boolean;
    readonly status?: number;

    constructor(message: string, retryable: boolean, status?: number) {
        super(message);
        this.name = "DungeonProbeError";
        this.retryable = retryable;
        this.status = status;
    }
}

function dungeonProbeFailure(message: string, status?: number): DungeonProbeError {
    const terminal = status === 400 || status === 403 || status === 404
        || status === 409 || status === 410 || status === 422;
    return new DungeonProbeError(message, !terminal, status);
}
export async function mutateDungeonRunServer(playerName: string, action: 'start' | 'settle' | 'abandon', token = ''): Promise<{ character: Character; token: string; _saveVersion?: number }> {
    const response = await fetch('/api/dungeon/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, token }) });
    const data = await response.json().catch(() => null) as { character?: Character; token?: string; error?: string; _saveVersion?: number } | null;
    if (!response.ok || !data?.character || !data.token) throw new Error(data?.error || 'Dungeon run could not be verified.');
    return { character: data.character, token: data.token, _saveVersion: data._saveVersion };
}

export async function probeFreeDungeonServer(playerName: string, sector: number, requestId: string): Promise<{
    character: Character;
    requestId: string;
    found: boolean;
    token: string;
    sector: number;
    resolved: boolean;
    worldExploreRequestId?: string;
    _saveVersion?: number;
}> {
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) throw new Error('The dungeon attempt has no stable recovery id.');
    let response: Response;
    try {
        response = await fetch('/api/dungeon/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, action: 'probe-free', sector, requestId }),
        });
    } catch {
        throw dungeonProbeFailure('The hidden-dungeon server is unreachable.');
    }
    const data = await response.json().catch(() => null) as {
        character?: Character;
        requestId?: string;
        found?: boolean;
        token?: string;
        sector?: number;
        exploreReceiptId?: string;
        worldExploreRequestId?: string;
        resolved?: boolean;
        error?: string;
        _saveVersion?: number;
    } | null;
    if (!response.ok || !data?.character) {
        throw dungeonProbeFailure(data?.error || 'The hidden-dungeon search could not be verified.', response.ok ? undefined : response.status);
    }
    if (!data.requestId || !/^[A-Za-z0-9_-]{8,96}$/.test(data.requestId)) {
        throw new Error('The dungeon server omitted the recovery id.');
    }
    const active = data.character.activeDungeonRun && typeof data.character.activeDungeonRun === "object"
        ? data.character.activeDungeonRun as Record<string, unknown>
        : null;
    const sealedSector = Math.floor(Number(data.sector ?? active?.sector ?? sector));
    if (!Number.isSafeInteger(sealedSector) || sealedSector < 1) {
        throw new Error("The dungeon server omitted the sealed discovery sector.");
    }
    const boundRequestId = data.exploreReceiptId ?? data.worldExploreRequestId
        ?? (typeof active?.exploreReceiptId === "string" ? active.exploreReceiptId : undefined);
    return {
        character: data.character,
        requestId: data.requestId,
        found: data.found === true,
        token: data.token ?? '',
        sector: sealedSector,
        resolved: data.resolved === true,
        ...(boundRequestId ? { worldExploreRequestId: boundRequestId } : {}),
        _saveVersion: data._saveVersion,
    };
}
