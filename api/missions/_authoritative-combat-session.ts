import { createHash } from 'node:crypto';
import type { SoloPveSession } from '../solo-pve/_session.js';
import type { CombatMissionDef } from './_mission-catalog.js';

export const MISSION_COMBAT_SESSION_TTL_MS = 45 * 60 * 1000;
export const MISSION_COMBAT_SESSION_TTL_SECONDS = Math.ceil(MISSION_COMBAT_SESSION_TTL_MS / 1000);

export function missionCombatBindingKey(runId: string): string {
    return `mission-combat-binding:${runId}`;
}

export function missionCombatActiveKey(playerName: string, missionId: string): string {
    return `mission-combat-active:${playerName}:${missionId}`;
}

export interface MissionCombatActivePointer {
    version: 1;
    sessionId: string;
    runId: string;
    playerName: string;
    missionId: string;
    createdAt: number;
    expiresAt: number;
}

export interface MissionCombatBinding {
    version: 1;
    sessionId: string;
    runId: string;
    playerName: string;
    missionId: string;
    enemyProfileId: string;
    rewardFingerprint: string;
    createdAt: number;
    expiresAt: number;
    status: 'active' | 'won' | 'lost' | 'abandoned';
    settledAt?: number;
}

export type MissionCombatValidation =
    | { ok: true; binding: MissionCombatBinding }
    | { ok: false; reason: 'invalid-binding' | 'wrong-player' | 'wrong-mission' | 'wrong-run' | 'expired' | 'already-settled' | 'not-settled' | 'not-complete' | 'not-won' | 'not-a-member' | 'reward-drift' };

export function missionCombatRewardFingerprint(def: CombatMissionDef): string {
    return createHash('sha256').update(JSON.stringify({
        missionId: def.key,
        enemyProfileId: def.aiProfileId,
        xp: def.xp,
        ryo: def.ryo,
        territoryScrolls: def.territoryScrolls,
    })).digest('hex');
}

export function createMissionCombatBinding(params: {
    runId: string;
    playerName: string;
    mission: CombatMissionDef;
    now?: number;
    sessionId?: string;
}): MissionCombatBinding {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        sessionId: params.sessionId ?? params.runId,
        runId: params.runId,
        playerName: params.playerName,
        missionId: params.mission.key,
        enemyProfileId: params.mission.aiProfileId,
        rewardFingerprint: missionCombatRewardFingerprint(params.mission),
        createdAt: now,
        expiresAt: now + MISSION_COMBAT_SESSION_TTL_MS,
        status: 'active',
    };
}

export function createMissionCombatActivePointer(params: {
    runId: string;
    playerName: string;
    mission: CombatMissionDef;
    now?: number;
    sessionId?: string;
}): MissionCombatActivePointer {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        sessionId: params.sessionId ?? params.runId,
        runId: params.runId,
        playerName: params.playerName,
        missionId: params.mission.key,
        createdAt: now,
        expiresAt: now + MISSION_COMBAT_SESSION_TTL_MS,
    };
}

/**
 * Recover an in-flight mission only when all three durable records agree.
 * This makes start idempotent without letting a stale pointer revive a settled,
 * expired, cross-player, or differently-authored encounter.
 */
export function resumableMissionCombatSession(params: {
    active: MissionCombatActivePointer | null | undefined;
    binding: MissionCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    mission: CombatMissionDef;
    now?: number;
}): SoloPveSession | null {
    const { active, binding, session, playerName, mission } = params;
    const now = params.now ?? Date.now();
    if (!active || active.version !== 1 || !active.runId || !active.sessionId) return null;
    if (active.playerName !== playerName || active.missionId !== mission.key || active.expiresAt <= now) return null;
    if (!binding || binding.version !== 1 || binding.status !== 'active' || binding.settledAt || binding.expiresAt <= now) return null;
    if (binding.playerName !== playerName
        || binding.missionId !== mission.key
        || binding.enemyProfileId !== mission.aiProfileId
        || binding.rewardFingerprint !== missionCombatRewardFingerprint(mission)) return null;
    if (active.runId !== binding.runId
        || active.sessionId !== binding.sessionId
        || active.runId !== active.sessionId) return null;
    if (!session
        || session.sessionId !== active.sessionId
        || session.ownerSlug !== playerName
        || session.settlementState !== 'pending'
        || session.expiresAt <= now) return null;
    if (session.encounter.kind !== 'mission'
        || session.encounter.id !== mission.key
        || session.encounter.sourceId !== mission.aiProfileId
        || session.encounter.bindingId !== binding.runId) return null;
    return session;
}

export function validateCompletedMissionCombatSession(params: {
    binding: MissionCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    mission: CombatMissionDef;
    now?: number;
}): MissionCombatValidation {
    const { binding, session, playerName, mission } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.sessionId || !binding.runId) return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (binding.missionId !== mission.key || binding.enemyProfileId !== mission.aiProfileId) return { ok: false, reason: 'wrong-mission' };
    if (!session || binding.sessionId !== session.sessionId || binding.runId !== session.sessionId) return { ok: false, reason: 'wrong-run' };
    if (binding.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done') return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'player') return { ok: false, reason: 'not-won' };
    if (session.ownerSlug !== playerName) return { ok: false, reason: 'not-a-member' };
    if (session.encounter.kind !== 'mission'
        || session.encounter.id !== mission.key
        || session.encounter.sourceId !== mission.aiProfileId
        || session.encounter.bindingId !== binding.runId) {
        return { ok: false, reason: 'wrong-mission' };
    }
    if (binding.rewardFingerprint !== missionCombatRewardFingerprint(mission)) return { ok: false, reason: 'reward-drift' };
    return { ok: true, binding };
}

/** Validate the durable terminal state used to answer a lost settle response. */
export function validateSettledMissionCombatSession(params: {
    binding: MissionCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    mission: CombatMissionDef;
    now?: number;
}): MissionCombatValidation {
    const { binding, session, playerName, mission } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.sessionId || !binding.runId) return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (binding.missionId !== mission.key || binding.enemyProfileId !== mission.aiProfileId) return { ok: false, reason: 'wrong-mission' };
    if (!session || binding.sessionId !== session.sessionId || binding.runId !== session.sessionId) return { ok: false, reason: 'wrong-run' };
    if (binding.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (!binding.settledAt || binding.status !== 'won' || session.settlementState !== 'settled') return { ok: false, reason: 'not-settled' };
    if (session.status !== 'done') return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'player') return { ok: false, reason: 'not-won' };
    if (session.ownerSlug !== playerName) return { ok: false, reason: 'not-a-member' };
    if (session.encounter.kind !== 'mission'
        || session.encounter.id !== mission.key
        || session.encounter.sourceId !== mission.aiProfileId
        || session.encounter.bindingId !== binding.runId) {
        return { ok: false, reason: 'wrong-mission' };
    }
    if (binding.rewardFingerprint !== missionCombatRewardFingerprint(mission)) return { ok: false, reason: 'reward-drift' };
    return { ok: true, binding };
}

export function settleMissionCombatBinding(binding: MissionCombatBinding, now = Date.now()): MissionCombatBinding {
    if (binding.status !== 'active' || binding.settledAt) return binding;
    return { ...binding, status: 'won', settledAt: now };
}
