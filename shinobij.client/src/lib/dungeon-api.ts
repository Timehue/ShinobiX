import type { Character } from '../types/character';
import { runSingleFlight } from './single-flight';

export class DungeonProbeError extends Error {
    readonly retryable: boolean;
    readonly status?: number;
    readonly reason?: string;

    constructor(message: string, retryable: boolean, status?: number, reason?: string) {
        super(message);
        this.name = "DungeonProbeError";
        this.retryable = retryable;
        this.status = status;
        this.reason = reason;
    }
}

function dungeonProbeFailure(message: string, status?: number, reason?: string): DungeonProbeError {
    const retryable = reason !== 'daily-limit' && (status === undefined || status >= 500
        || status === 401 || status === 408 || status === 425 || status === 429 || reason === 'no-presence');
    return new DungeonProbeError(message, retryable, status, reason);
}

export function dungeonProbeFailureMessage(error: unknown): string {
    if (!(error instanceof DungeonProbeError)) return 'The hidden-dungeon search could not be verified. Try exploring again to recover your saved attempt.';
    if (error.reason === 'daily-limit') return 'Daily hidden-dungeon search limit reached (150/150). Resets at midnight UTC.';
    if (error.status === 401) return 'Your session needs to reconnect. Sign in again, then explore to recover your saved attempt.';
    if (error.status === 429) return 'Too many exploration requests. Wait a moment, then try again; your saved attempt will be reused.';
    if (!error.retryable) return error.message;
    return error.message + ' Try exploring again; your saved attempt will be reused.';
}

export async function mutateDungeonRunServer(playerName: string, action: 'start' | 'settle' | 'abandon', token = ''): Promise<{ character: Character; token: string; _saveVersion?: number }> {
    const response = await fetch('/api/dungeon/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, action, token }) });
    const data = await response.json().catch(() => null) as { character?: Character; token?: string; error?: string; _saveVersion?: number } | null;
    if (!response.ok || !data?.character || !data.token) throw new Error(data?.error || 'Dungeon run could not be verified.');
    return { character: data.character, token: data.token, _saveVersion: data._saveVersion };
}

type DungeonProbeResult = {
    character: Character;
    requestId: string;
    found: boolean;
    token: string;
    sector: number;
    resolved: boolean;
    worldExploreRequestId?: string;
    _saveVersion?: number;
};

const pendingDungeonProbes = new Map<string, Promise<DungeonProbeResult>>();

export async function probeFreeDungeonServer(playerName: string, sector: number, requestId: string): Promise<DungeonProbeResult> {
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) {
        throw new DungeonProbeError('The dungeon attempt has no stable recovery id.', false);
    }
    // Map recovery and Explore can ask for the same receipt simultaneously.
    // Share their retry sequence to avoid unnecessary contention on the save.
    return runSingleFlight(pendingDungeonProbes, JSON.stringify([playerName, sector, requestId]), async () => {
        for (let attempt = 0; ; attempt++) {
            try {
                return await requestFreeDungeonProbe(playerName, sector, requestId);
            } catch (error) {
                const transient = error instanceof DungeonProbeError && error.retryable
                    && (error.status === undefined || error.status >= 500 || error.status === 408
                        || error.status === 425 || error.reason === 'no-presence');
                if (!transient || attempt >= 2) throw error;
                // Exact-id replay recovers a committed roll without another attempt.
                // Authentication and rate limits need their own recovery, not a burst.
                await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
    });
}

async function requestFreeDungeonProbe(playerName: string, sector: number, requestId: string): Promise<DungeonProbeResult> {
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
        reason?: string;
        _saveVersion?: number;
    } | null;
    if (!response.ok) {
        // Older servers omit the presence reason during a rolling deployment.
        const reason = data?.reason ?? (data?.error === 'Your world presence is not ready — give it a moment and try again.'
            ? 'no-presence' : data?.error);
        throw dungeonProbeFailure(data?.error || 'The hidden-dungeon search could not be verified.', response.status, reason);
    }
    if (!data?.character || typeof data.character !== 'object' || Array.isArray(data.character)) {
        throw dungeonProbeFailure('The hidden-dungeon search could not be verified.');
    }
    if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(data.requestId)) {
        throw dungeonProbeFailure('The dungeon server omitted the recovery id.');
    }
    const active = data.character.activeDungeonRun && typeof data.character.activeDungeonRun === 'object'
        ? data.character.activeDungeonRun as Record<string, unknown>
        : null;
    const sealedSector = data.sector ?? active?.sector;
    if (typeof sealedSector !== 'number' || !Number.isSafeInteger(sealedSector) || sealedSector < 1 || sealedSector > 66) {
        throw dungeonProbeFailure('The dungeon server omitted the sealed discovery sector.');
    }
    if (typeof data.found !== 'boolean' || (data.found && (typeof data.token !== 'string' || !data.token))) {
        throw dungeonProbeFailure('The dungeon server returned an incomplete discovery.');
    }
    const boundRequestId = data.exploreReceiptId ?? data.worldExploreRequestId
        ?? (typeof active?.exploreReceiptId === 'string' ? active.exploreReceiptId : undefined);
    if (boundRequestId !== undefined && (typeof boundRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(boundRequestId))) {
        throw dungeonProbeFailure('The dungeon server omitted the exploration recovery id.');
    }
    return {
        character: data.character,
        requestId: data.requestId,
        found: data.found,
        token: data.token ?? '',
        sector: sealedSector,
        resolved: data.resolved === true,
        ...(boundRequestId ? { worldExploreRequestId: boundRequestId } : {}),
        _saveVersion: data._saveVersion,
    };
}
