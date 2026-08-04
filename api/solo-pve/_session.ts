import type {
    CombatFxTarget,
    CombatJutsu,
    CombatItem,
} from '../combat-core/types.js';
import type { PvpFighter, PvpGroundEffect } from '../pvp/session.js';
import { assertSoloPveLoadoutCompatible } from './_compatibility.js';

export const SOLO_PVE_RUNTIME = 'solo-pve' as const;
export const SOLO_PVE_SCHEMA_VERSION = 1 as const;
export const SOLO_PVE_SESSION_TTL_SECONDS = 30 * 60;
export const SOLO_PVE_TERMINAL_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SOLO_PVE_MOVE_TOKEN_HISTORY = 32;
export const SOLO_PVE_EVENT_HISTORY = 80;

export type SoloPveSide = 'player' | 'enemy';
export type SoloPveWinner = SoloPveSide | 'draw' | null;
export type SoloPveOutcome = 'win' | 'loss' | 'fled' | 'draw' | null;
export type SoloPveSettlementState = 'pending' | 'settled';

export type SoloPveSettlementReceipt = {
    kind: string;
    id: string;
    settledAt: number;
    rewards?: Record<string, number | string | boolean | null>;
};

export type SoloPveTerminalEvidence = {
    finishedAt: number;
    finalMoveToken: string;
    finalVersion: number;
    finalEventSeq: number;
    winner: Exclude<SoloPveWinner, null>;
    outcome: Exclude<SoloPveOutcome, null>;
    itemsUsed: Record<string, number>;
    settlementState: SoloPveSettlementState;
    receipt?: SoloPveSettlementReceipt;
};

export type SoloPveEncounter = {
    kind: string;
    id: string;
    sourceId?: string;
    level?: number;
    bindingId?: string;
    metadata?: Record<string, string | number | boolean | null>;
};
export type SoloPveEnvironment = {
    biome: string;
    weatherPositiveElement?: string;
    weatherNegativeElement?: string;
    blockedTiles: number[];
};

export type SoloPveDifficultyGuard = {
    enemyLevel: number;
    playerHpTurnStart: number;
    dealtThisTurn: number;
};

export type SoloPveFighterEventState = {
    hp: number;
    maxHp: number;
    chakra: number;
    stamina: number;
    shield: number;
    pos: number;
    statuses: PvpFighter['statuses'];
};

export type SoloPveEventSnapshot = {
    player: SoloPveFighterEventState;
    enemy: SoloPveFighterEventState;
    ap: Record<SoloPveSide, number>;
    cooldowns: Record<SoloPveSide, Record<string, number>>;
    groundEffects: PvpGroundEffect[];
    itemCharges: Record<string, number>;
    itemsUsed: Record<string, number>;
};

export type SoloPveVfxEvent = {
    key: string;
    target: SoloPveSide | 'tile' | 'area';
    anchor: 'caster' | 'target' | 'tile' | 'area';
    tiles?: number[];
    persistent?: boolean;
};

/**
 * Durable, ordered combat evidence. The client renders this stream, but combat
 * and settlement never read it back as authority. Full before/after snapshots
 * make overkill, shields, resources, displacement, statuses, zones, and items
 * unambiguous without asking the client to reconstruct server outcomes.
 */
export type SoloPveCombatEvent = {
    kind: 'action';
    seq: number;
    round: number;
    actor: SoloPveSide;
    target: SoloPveSide | 'tile' | null;
    action: SoloPveAction['type'];
    actionId?: string;
    actionName?: string;
    tile?: number;
    before: SoloPveEventSnapshot;
    after: SoloPveEventSnapshot;
    log: string[];
    vfx: SoloPveVfxEvent[];
    status: SoloPveSession['status'];
    winner: SoloPveWinner;
    outcome: SoloPveOutcome;
};

/** Response-only evidence for an intent the server refused. */
export type SoloPveRejectionEvent = {
    kind: 'rejected';
    round: number;
    actor: SoloPveSide;
    action: SoloPveAction['type'];
    actionId?: string;
    tile?: number;
    reason: string;
};

export type SoloPveSession = {
    runtime: typeof SOLO_PVE_RUNTIME;
    schemaVersion: typeof SOLO_PVE_SCHEMA_VERSION;
    sessionId: string;
    ownerSlug: string;
    encounter: SoloPveEncounter;
    player: PvpFighter;
    enemy: PvpFighter;
    round: number;
    activeSide: SoloPveSide;
    ap: Record<SoloPveSide, number>;
    actionsThisTurn: number;
    cooldowns: Record<SoloPveSide, Record<string, number>>;
    groundEffects: PvpGroundEffect[];
    itemCharges: Record<string, number>;
    itemsUsed: Record<string, number>;
    environment: SoloPveEnvironment;
    difficultyGuard?: SoloPveDifficultyGuard;
    status: 'active' | 'done';
    winner: SoloPveWinner;
    outcome: SoloPveOutcome;
    settlementState: SoloPveSettlementState;
    terminalEvidence?: SoloPveTerminalEvidence;
    log: string[];
    events: SoloPveCombatEvent[];
    eventSeq: number;
    fx?: CombatFxTarget[];
    fxSeq?: number;
    version: number;
    recentMoveTokens: string[];
    createdAt: number;
    lastActionAt: number;
    expiresAt: number;
};

export type CreateSoloPveSessionParams = {
    sessionId: string;
    ownerSlug: string;
    encounter: SoloPveEncounter;
    player: PvpFighter;
    enemy: PvpFighter;
    now: number;
    environment?: Partial<SoloPveEnvironment>;
    itemCharges?: Record<string, number>;
    difficultyEnemyLevel?: number;
};

function cloneFighter(fighter: PvpFighter): PvpFighter {
    return {
        ...fighter,
        statuses: fighter.statuses.map((status) => ({ ...status })),
        character: structuredClone(fighter.character),
    };
}

export function createSoloPveSession(params: CreateSoloPveSessionParams): SoloPveSession {
    const now = Math.max(0, Math.floor(params.now));
    const player = cloneFighter(params.player);
    const enemy = cloneFighter(params.enemy);
    assertSoloPveLoadoutCompatible(player.character);
    assertSoloPveLoadoutCompatible(enemy.character);
    const difficultyLevel = Number(params.difficultyEnemyLevel);
    return {
        runtime: SOLO_PVE_RUNTIME,
        schemaVersion: SOLO_PVE_SCHEMA_VERSION,
        sessionId: params.sessionId,
        ownerSlug: params.ownerSlug,
        encounter: structuredClone(params.encounter),
        player,
        enemy,
        round: 1,
        activeSide: 'player',
        ap: { player: 100, enemy: 100 },
        actionsThisTurn: 0,
        cooldowns: { player: {}, enemy: {} },
        groundEffects: [],
        itemCharges: { ...(params.itemCharges ?? {}) },
        itemsUsed: {},
        environment: {
            biome: params.environment?.biome ?? 'central',
            weatherPositiveElement: params.environment?.weatherPositiveElement,
            weatherNegativeElement: params.environment?.weatherNegativeElement,
            blockedTiles: [...(params.environment?.blockedTiles ?? [])],
        },
        ...(Number.isFinite(difficultyLevel) && difficultyLevel > 0 ? {
            difficultyGuard: {
                enemyLevel: Math.floor(difficultyLevel),
                playerHpTurnStart: player.hp,
                dealtThisTurn: 0,
            },
        } : {}),
        status: 'active',
        winner: null,
        outcome: null,
        settlementState: 'pending',
        log: [`Battle started: ${player.name} versus ${enemy.name}.`],
        events: [],
        eventSeq: 0,
        version: 1,
        recentMoveTokens: [],
        createdAt: now,
        lastActionAt: now,
        expiresAt: now + SOLO_PVE_SESSION_TTL_SECONDS * 1000,
    };
}

export function isSoloPveSession(value: unknown): value is SoloPveSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<SoloPveSession>;
    return session.runtime === SOLO_PVE_RUNTIME
        && session.schemaVersion === SOLO_PVE_SCHEMA_VERSION
        && typeof session.sessionId === 'string'
        && typeof session.ownerSlug === 'string'
        && typeof session.version === 'number'
        && (session.status === 'active' || session.status === 'done');
}

export type SoloPveJutsu = CombatJutsu & {
    visualEffect?: string;
    suppressBloodline?: boolean;
};

export type SoloPveItem = CombatItem;

export type SoloPveAction =
    | { type: 'move'; tile: number }
    | { type: 'basicAttack' }
    | { type: 'basicHeal' }
    | { type: 'clear' }
    | { type: 'cleanse' }
    | { type: 'jutsu'; jutsuId: string; tile?: number }
    | { type: 'weapon'; itemId: string }
    | { type: 'item'; itemId: string }
    | { type: 'wait' }
    | { type: 'flee' };

export type SoloPveActionResult = {
    applied: boolean;
    reason?: string;
    event?: SoloPveCombatEvent | SoloPveRejectionEvent;
    session: SoloPveSession;
};
