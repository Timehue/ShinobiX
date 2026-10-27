import type { WorldBossContribution, WorldBossEventStatus, WorldBossId } from '../../../shared/world-boss-event';
import type { TowerHostLoadout, TowerSession } from './towers-api';

export type WorldBossEventClientState = {
    event: null | {
        eventId: string;
        bossId: WorldBossId;
        bossName: string;
        status: WorldBossEventStatus;
        startedAt: number;
        roamEndsAt: number;
        endsAt: number;
        endedAt: number | null;
        spawnSector: number | null;
        targetVillage: string | null;
        targetSector: number | null;
        destinationReached: boolean;
        hp: number;
        hpMax: number;
        currentSector: number | null;
        /** Absent from a server that predates the in-sector patrol. */
        previousSector?: number | null;
        nextSector: number | null;
        nextHopInMs: number;
        movementPaused: boolean;
        threatenedVillage: string | null;
        minedCrystalNodeIds: string[];
        crystalNodesMined: number;
        crystalNodeCount: number;
        hollowShardsDeposited: number;
        topCachesPending: boolean;
        topCacheSnapshotExpired?: boolean;
        retreatPenaltyUntil: number;
        active: boolean;
        participantCount: number;
    };
    queue?: {
        waitingCount: number;
        waitingSince?: number | null;
        queueClosesAt?: number | null;
        rejoinAfter?: number | null;
        queued?: boolean;
        match?: null | {
            matchId: string;
            status: 'preparing' | 'active' | 'settled' | 'cancelled';
            runId: string;
            session?: TowerSession;
            error?: string;
            reward?: { ryo: number; statPoints: number; boneCharms: number; itemIds: string[]; gearDrop?: string };
            contribution?: WorldBossContribution;
        };
    };
    personal?: {
        damage: number;
        score: number;
        actions: number;
        matches: number;
        hollowShardsHeld: number;
        hollowShardsDeposited: number;
        crystalPoints: number;
        points: number;
        hollowBeastCacheRank?: number;
        hollowBeastCacheAwarded?: boolean;
    } | null;
    personalRank?: number | null;
    character?: Record<string, unknown>;
    _saveVersion?: number;
    standings?: {
        individual: Array<{ rank: number; name: string; damage: number; crystalPoints: number; hollowShardsDeposited: number; supportPoints: number; points: number }>;
        villages: Array<{ rank: number; name: string; damage: number; crystalPoints: number; supportPoints: number; points: number }>;
        clans: Array<{ rank: number; name: string; damage: number; crystalPoints: number; supportPoints: number; points: number }>;
    };
    serverNow: number;
};

export type WorldBossQueueMutation = {
    ok?: boolean;
    error?: string;
    rejoinAfter?: number | null;
    queue?: WorldBossEventClientState['queue'];
    serverNow?: number;
};

export type WorldBossSettlement = {
    settled: boolean;
    eventId: string;
    matchId: string;
    bankedDamage: number;
    hpRemaining: number;
    contribution: WorldBossContribution | null;
    reward: { ryo: number; statPoints: number; boneCharms: number; itemIds: string[]; gearDrop?: string } | null;
    rewardSummary: string;
    gearDrop?: { itemId?: string };
    character?: Record<string, unknown>;
    _saveVersion?: number;
};

let serverClockOffsetMs = 0;

/** The server's clock as of the last event read, so every player sees the boss at the same point of its patrol. */
export function worldBossServerNow(): number {
    return Date.now() + serverClockOffsetMs;
}

export async function fetchWorldBossEvent(playerName?: string): Promise<WorldBossEventClientState | null> {
    try {
        const query = playerName ? `?playerName=${encodeURIComponent(playerName)}` : '';
        const response = await fetch(`/api/world-boss-event${query}`, { method: 'GET', cache: 'no-store' });
        if (!response.ok) return null;
        const state = await response.json() as WorldBossEventClientState;
        // The anonymous read is publicly cacheable for 5 s. A cached copy says
        // how old it is, and its serverNow is that much behind the server.
        const ageMs = Math.max(0, Number(response.headers.get('age')) || 0) * 1000;
        if (Number.isFinite(state.serverNow)) serverClockOffsetMs = state.serverNow + ageMs - Date.now();
        return state;
    } catch {
        return null;
    }
}

export async function mutateWorldBossQueue(input: {
    playerName: string;
    action: 'join' | 'leave';
    hostLoadout?: TowerHostLoadout;
}): Promise<WorldBossQueueMutation> {
    try {
        const response = await fetch('/api/world-boss-event/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });
        const body = await response.json().catch(() => ({})) as WorldBossQueueMutation;
        if (!response.ok) return { ...body, ok: false, error: body.error ?? 'The world boss queue did not answer. Try again in a moment.' };
        return { ...body, ok: true };
    } catch {
        return { ok: false, error: 'The world boss queue is offline. Try again shortly.' };
    }
}

export type WorldBossHollowShardDeposit = {
    ok: boolean;
    error?: string;
    replayed?: boolean;
    deposited?: number;
    points?: number;
    heldHollowShards?: number;
    totalDeposited?: number;
    serverNow?: number;
};

export async function depositWorldBossHollowShards(input: { eventId: string; playerName: string }): Promise<WorldBossHollowShardDeposit> {
    try {
        const response = await fetch('/api/world-boss-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'depositHollowShards', ...input, requestId: crypto.randomUUID() }),
        });
        const body = await response.json().catch(() => ({})) as WorldBossHollowShardDeposit;
        return response.ok ? { ...body, ok: true } : { ...body, ok: false, error: body.error ?? 'Your Hollow Shard turn-in could not be confirmed. Refresh the event before trying again.' };
    } catch {
        return { ok: false, error: 'Your Hollow Shard turn-in could not be confirmed. Refresh the event and your shard balance before trying again.' };
    }
}

export async function settleWorldBossEvent(runId: string, playerName: string): Promise<WorldBossSettlement> {
    let response: Response;
    try {
        response = await fetch('/api/world-boss-event/settle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId, playerName }),
        });
    } catch {
        throw new Error('Your world boss result could not be confirmed. Press Try again on the result screen.');
    }
    const body = await response.json().catch(() => ({})) as Partial<WorldBossSettlement> & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Your world boss result could not be confirmed.');
    return body as WorldBossSettlement;
}
