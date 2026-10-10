import type { WorldBossContribution, WorldBossEventStatus, WorldBossEventPosition, WorldBossId } from '../../../shared/world-boss-event';
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

export async function fetchWorldBossEvent(playerName?: string): Promise<WorldBossEventClientState | null> {
    try {
        const query = playerName ? `?playerName=${encodeURIComponent(playerName)}` : '';
        const response = await fetch(`/api/world-boss-event${query}`, { method: 'GET', cache: 'no-store' });
        if (!response.ok) return null;
        return await response.json() as WorldBossEventClientState;
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
        if (!response.ok) return { ...body, ok: false, error: body.error ?? `Queue request failed (${response.status}).` };
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
        return response.ok ? { ...body, ok: true } : { ...body, ok: false, error: body.error ?? 'Turn-in failed (' + response.status + ').' };
    } catch {
        return { ok: false, error: 'The Hollow Shard store is offline. Try again shortly.' };
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
        throw new Error('World boss settlement could not be confirmed. Retry settlement from the result screen.');
    }
    const body = await response.json().catch(() => ({})) as Partial<WorldBossSettlement> & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'World boss settlement could not be confirmed.');
    return body as WorldBossSettlement;
}

export type WorldBossPositionClient = WorldBossEventPosition;
