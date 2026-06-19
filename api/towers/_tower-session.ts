/*
 * Battle Towers — live battle SESSION model (Phase 1, P1.A1).
 *
 * The N-actor generalization of PvpSession: instead of hard-coded p1/p2, the session
 * holds an ARRAY of actors, each tagged with a side (squad/enemy/npc), plus a computed
 * turn queue and per-actor combat state. This is the authoritative live record
 * persisted under tower:<runId> (KV); the deterministic engine (_engine.ts) resolves
 * actions against it. See docs/battle-towers-plan.md §4, §6, §25, §28.
 *
 * Reuses the PvP status / ground-effect SHAPES (import type only — fully erased, so no
 * runtime coupling to the PvP handler) so combat semantics match the live game. The
 * deterministic engine must never read createdAt/lastActionAt (wall-clock set by the
 * handler); they live here for TTL/AFK bookkeeping only, exactly like PvpSession.
 */
import type { PvpStatus, PvpGroundEffect } from '../pvp/session.js';

export type TowerActorId = string;
export type TowerSide = 'squad' | 'enemy' | 'npc';

export type TowerActor = {
    id: TowerActorId;
    side: TowerSide;
    name: string;
    /** controlling player's slug for squad humans; null for AI (enemies, npcs, async allies, AFK) */
    ownerSlug: string | null;
    /** true when the engine's AI policy drives this actor (enemies/npcs; async allies; AFK humans) */
    ai: boolean;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: PvpStatus[];
    cooldowns: Record<string, number>;
    /** hex tile index on the floor's map */
    pos: number;
    /** sealed, sanitized combat snapshot (stats / jutsu / equipment) — like PvpFighter.character */
    character: Record<string, unknown>;
};

export type TowerMap = {
    width: number;
    height: number;
    blockedTiles: number[];
    hazardTiles: number[];
    objectiveTiles: number[];
};

export type TowerObjectiveState = {
    /** the floor's objective id (mirrors TowerObjective in _floor-catalog) */
    kind: string;
    npcAlive?: boolean;
    reachedGoal?: boolean;
    addsRemaining?: number;
    roundsSurvived?: number;
    completed: boolean;
    failed: boolean;
};

export type TowerPhaseState = {
    bossId?: TowerActorId;
    /** boss HP-threshold phases (descending %) not yet triggered; the engine pops them as HP crosses */
    pendingPhases: number[];
    triggeredPhases: number[];
};

export type TowerStatus = 'active' | 'done';

export type TowerSession = {
    towerId: string;
    runId: string;
    floor: number;
    seed: number;
    partySize: number;
    map: TowerMap;
    actors: TowerActor[];
    /** ordered actor ids for the round, incl. enemy-interrupt slots (built by the engine) */
    turnQueue: TowerActorId[];
    /** index into turnQueue of the actor currently to move */
    activeIndex: number;
    round: number;
    /** remaining AP for the active actor's turn (the per-turn budget) */
    activeAp: number;
    /** actions taken by the active actor this turn (caps at MAX_ACTIONS) */
    actionsThisTurn: number;
    groundEffects: PvpGroundEffect[];
    objectiveState: TowerObjectiveState;
    phaseState: TowerPhaseState;
    status: TowerStatus;
    winner: TowerSide | 'draw' | null;
    /** idempotency ring for action retries (mirrors PvP recentMoveTokens) */
    recentMoveTokens: string[];
    rewardSettlementState: 'pending' | 'settled';
    log: string[];
    createdAt: number;
    lastActionAt: number;
};

// ─── accessors / invariants ──────────────────────────────────────────────────

export function getActor(session: TowerSession, id: TowerActorId): TowerActor | undefined {
    return session.actors.find(a => a.id === id);
}

export function actorsOnSide(session: TowerSession, side: TowerSide): TowerActor[] {
    return session.actors.filter(a => a.side === side);
}

export function livingOnSide(session: TowerSession, side: TowerSide): TowerActor[] {
    return session.actors.filter(a => a.side === side && a.hp > 0);
}

export function isSideAlive(session: TowerSession, side: TowerSide): boolean {
    return session.actors.some(a => a.side === side && a.hp > 0);
}

/** The actor whose turn it currently is (undefined if the queue is exhausted / session done). */
export function activeActor(session: TowerSession): TowerActor | undefined {
    const id = session.turnQueue[session.activeIndex];
    return id ? getActor(session, id) : undefined;
}

// ─── factory ─────────────────────────────────────────────────────────────────

export type CreateTowerSessionParams = {
    towerId: string;
    runId: string;
    floor: number;
    seed: number;
    partySize: number;
    map: TowerMap;
    actors: TowerActor[];
    objectiveKind: string;
    bossId?: TowerActorId;
    bossPhases?: number[];
    /** wall-clock from the caller (handler) — kept OUT of the deterministic engine */
    now: number;
};

export function createTowerSession(p: CreateTowerSessionParams): TowerSession {
    const hasNpc = p.actors.some(a => a.side === 'npc');
    return {
        towerId: p.towerId,
        runId: p.runId,
        floor: p.floor,
        seed: p.seed,
        partySize: p.partySize,
        map: p.map,
        actors: p.actors,
        turnQueue: [],        // built by the engine on first advance
        activeIndex: 0,
        round: 1,
        activeAp: 0,
        actionsThisTurn: 0,
        groundEffects: [],
        objectiveState: {
            kind: p.objectiveKind,
            ...(hasNpc ? { npcAlive: true } : {}),
            completed: false,
            failed: false,
        },
        phaseState: {
            bossId: p.bossId,
            // descending so the engine pops the highest threshold first
            pendingPhases: (p.bossPhases ?? []).slice().sort((a, b) => b - a),
            triggeredPhases: [],
        },
        status: 'active',
        winner: null,
        recentMoveTokens: [],
        rewardSettlementState: 'pending',
        log: [],
        createdAt: p.now,
        lastActionAt: p.now,
    };
}
