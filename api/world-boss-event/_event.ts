import type { WorldBossContribution, WorldBossEventStatus, WorldBossId } from '../../shared/world-boss-event.js';
import { worldBossDefinition, worldBossThreatenedVillage } from '../../shared/world-boss-event.js';
import { kv } from '../_storage.js';

export const WORLD_BOSS_ACTIVE_KEY = 'world-boss-event:active';
export const WORLD_BOSS_EVENT_TTL_SECONDS = 90 * 24 * 60 * 60;
export const WORLD_BOSS_QUEUE_TTL_SECONDS = 8 * 24 * 60 * 60;
export const WORLD_BOSS_MATCH_HP_PER_PLAYER = 28_000;

export const worldBossEventKey = (eventId: string) => `world-boss-event:${eventId}`;
export const worldBossQueueKey = (eventId: string) => `world-boss-event:${eventId}:queue`;
export const worldBossMatchKey = (eventId: string, matchId: string) => `world-boss-event:${eventId}:match:${matchId}`;
export const worldBossPlayerKey = (eventId: string, slug: string) => `world-boss-event:${eventId}:player:${slug}`;
export const worldBossQueueCooldownKey = (slug: string) => `world-boss-event:queue-cooldown:${slug}`;

export type WorldBossContributionResult = WorldBossContribution & {
    score: number;
    active: boolean;
};

export type WorldBossParticipant = {
    slug: string;
    name: string;
    village: string;
    clan: string;
    damage: number;
    score: number;
    hollowShardsDeposited: number;
    crystalPoints: number;
    actions: number;
    matches: number;
    firstAt: number;
};

export type WorldBossEventRecord = {
    version: 1;
    eventId: string;
    bossId: WorldBossId;
    bossName: string;
    status: WorldBossEventStatus;
    startedAt: number;
    roamEndsAt: number;
    endsAt: number;
    /** Admin-selected route endpoints. Optional only for backwards compatibility. */
    spawnSector?: number;
    targetVillage?: string;
    endedAt: number | null;
    hpMax: number;
    hp: number;
    participants: Record<string, WorldBossParticipant>;
    settledMatchIds: string[];
    movementPausedAt?: number | null;
    movementPausedTotalMs?: number;
    minedCrystalNodeIds?: string[];
    hollowShardsHeldByPlayer?: Record<string, number>;
    hollowShardProfileByPlayer?: Record<string, { name: string; village: string; clan: string }>;
    hollowShardsDeposited?: number;
    crystalDepositReceipts?: Record<string, { playerSlug: string; shards: number; points: number; depositedAt: number }>;
    topCacheRecipients?: Array<{ slug: string; name: string; rank: number }>;
    topCacheClaims?: Record<string, { rank: number; claimedAt: number }>;
    topCacheSettlementDeadlineAt?: number;
    topCacheSnapshotAt?: number;
    topCacheSnapshotExpired?: boolean;
    topCachesDistributedAt?: number;
    retreatPenaltyApplied?: boolean;
    retreatPenaltyVillage?: string;
    retreatPenaltyUntil?: number;
    updatedAt: number;
};

export type WorldBossQueueTicket = {
    ticketId: string;
    slug: string;
    name: string;
    joinedAt: number;
    village: string;
    clan: string;
    loadout?: Record<string, unknown>;
};

export type WorldBossMatchMember = Omit<WorldBossQueueTicket, 'ticketId' | 'joinedAt'> & {
    contribution?: WorldBossContributionResult;
    reward?: WorldBossRewardReceipt;
};

export type WorldBossRewardReceipt = {
    ryo: number;
    statPoints: number;
    boneCharms: number;
    itemIds: string[];
    gearDrop?: string;
};

export type WorldBossMatchRecord = {
    matchId: string;
    eventId: string;
    runId: string;
    status: 'preparing' | 'active' | 'settled' | 'cancelled';
    members: WorldBossMatchMember[];
    createdAt: number;
    startedAt: number;
    matchHp: number;
    error?: string;
    settledAt?: number;
    teamDamage?: number;
    bankedDamage?: number;
};

export type WorldBossQueueRecord = {
    tickets: WorldBossQueueTicket[];
    activeMatchIds: string[];
    updatedAt: number;
};

export type WorldBossPlayerPointer = {
    ticketId?: string;
    matchId?: string;
    status: 'queued' | 'preparing' | 'active' | 'settled' | 'cancelled';
    updatedAt: number;
    error?: string;
};

export function emptyWorldBossQueue(now = Date.now()): WorldBossQueueRecord {
    return { tickets: [], activeMatchIds: [], updatedAt: now };
}

export async function readActiveWorldBossEvent(): Promise<WorldBossEventRecord | null> {
    const eventId = await kv.get<string>(WORLD_BOSS_ACTIVE_KEY);
    if (typeof eventId !== 'string' || !eventId) return null;
    return kv.get<WorldBossEventRecord>(worldBossEventKey(eventId));
}

export async function readWorldBossEvent(eventId: string): Promise<WorldBossEventRecord | null> {
    return kv.get<WorldBossEventRecord>(worldBossEventKey(eventId));
}

export async function writeWorldBossEvent(event: WorldBossEventRecord): Promise<void> {
    const written = await kv.set(worldBossEventKey(event.eventId), event, { ex: WORLD_BOSS_EVENT_TTL_SECONDS });
    if (written === null) throw new Error('World boss event state write rejected.');
}

export async function readWorldBossQueue(eventId: string): Promise<WorldBossQueueRecord> {
    return (await kv.get<WorldBossQueueRecord>(worldBossQueueKey(eventId))) ?? emptyWorldBossQueue();
}

export async function writeWorldBossQueue(eventId: string, queue: WorldBossQueueRecord): Promise<void> {
    const written = await kv.set(worldBossQueueKey(eventId), queue, { ex: WORLD_BOSS_QUEUE_TTL_SECONDS });
    if (written === null) throw new Error('World boss queue write rejected.');
}

export async function readWorldBossMatch(eventId: string, matchId: string): Promise<WorldBossMatchRecord | null> {
    return kv.get<WorldBossMatchRecord>(worldBossMatchKey(eventId, matchId));
}

export async function writeWorldBossMatch(match: WorldBossMatchRecord): Promise<void> {
    const written = await kv.set(worldBossMatchKey(match.eventId, match.matchId), match, { ex: WORLD_BOSS_EVENT_TTL_SECONDS });
    if (written === null) throw new Error('World boss match write rejected.');
}

export async function readWorldBossPlayerPointer(eventId: string, slug: string): Promise<WorldBossPlayerPointer | null> {
    return kv.get<WorldBossPlayerPointer>(worldBossPlayerKey(eventId, slug));
}

export async function readWorldBossQueueCooldownUntil(slug: string): Promise<number | null> {
    const value = Number(await kv.get<number>(worldBossQueueCooldownKey(slug)));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export async function writeWorldBossQueueCooldownUntil(slug: string, until: number, now = Date.now()): Promise<void> {
    const ttlSeconds = Math.ceil((until - now) / 1_000);
    if (ttlSeconds <= 0) return;
    const written = await kv.set(worldBossQueueCooldownKey(slug), Math.floor(until), { ex: ttlSeconds });
    if (written === null) throw new Error('World boss queue cooldown write rejected.');
}

export async function writeWorldBossPlayerPointer(eventId: string, slug: string, pointer: WorldBossPlayerPointer): Promise<void> {
    const written = await kv.set(worldBossPlayerKey(eventId, slug), pointer, { ex: WORLD_BOSS_EVENT_TTL_SECONDS });
    if (written === null) throw new Error('World boss player state write rejected.');
}

export function worldBossEventIsOpen(event: WorldBossEventRecord, now: number): boolean {
    return (event.status === 'roaming' || event.status === 'final-stand')
        && event.hp > 0
        && now < event.endsAt;
}

export function publicWorldBossEvent(event: WorldBossEventRecord, status: WorldBossEventStatus, position: { active: boolean; currentSector: number; nextSector: number; hopIndex: number; nextHopInMs: number; hopIntervalMs: number; movementPaused: boolean; targetSector: number | null; destinationReached: boolean } | null) {
    const minedCrystalNodeIds = event.minedCrystalNodeIds ?? [];
    const boss = worldBossDefinition(event.bossId);
    return {
        eventId: event.eventId,
        bossId: event.bossId,
        bossName: event.bossName === 'The Hollow Beast' && event.bossId === 'hollow-beast' ? boss.name : event.bossName || boss.name,
        status,
        startedAt: event.startedAt,
        roamEndsAt: event.roamEndsAt,
        endsAt: event.endsAt,
        spawnSector: event.spawnSector ?? null,
        targetVillage: event.targetVillage ?? null,
        targetSector: position?.targetSector ?? null,
        destinationReached: position?.destinationReached === true,
        endedAt: event.endedAt,
        hp: Math.max(0, Math.min(event.hpMax, event.hp)),
        hpMax: event.hpMax,
        currentSector: position?.currentSector ?? null,
        nextSector: position?.nextSector ?? null,
        nextHopInMs: position?.nextHopInMs ?? 0,
        movementPaused: position?.movementPaused === true,
        threatenedVillage: event.retreatPenaltyVillage ?? (status === 'final-stand' || status === 'retreated'
            ? event.targetVillage ?? worldBossThreatenedVillage(position?.currentSector ?? -1) : null),
        minedCrystalNodeIds,
        crystalNodesMined: minedCrystalNodeIds.length,
        hollowShardsDeposited: Math.max(0, Math.min(60, Math.floor(Number(event.hollowShardsDeposited) || 0))),
        topCachesPending: status === 'victory' && !Array.isArray(event.topCacheRecipients),
        topCacheSnapshotExpired: event.topCacheSnapshotExpired === true,
        retreatPenaltyUntil: event.retreatPenaltyUntil ?? 0,
        active: position?.active === true && (status === 'roaming' || status === 'final-stand') && event.hp > 0,
        participantCount: Object.keys(event.participants ?? {}).length,
    };
}
