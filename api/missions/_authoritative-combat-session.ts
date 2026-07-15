import { createHash, randomUUID } from 'node:crypto';
import type { TowerSession } from '../towers/_tower-session.js';
import type { CombatMissionDef } from './_mission-catalog.js';

export const MISSION_COMBAT_SESSION_TTL_MS = 45 * 60 * 1000;
export const MISSION_COMBAT_SESSION_TTL_SECONDS = Math.ceil(MISSION_COMBAT_SESSION_TTL_MS / 1000);

export function missionCombatBindingKey(runId: string): string {
    return `mission-combat-binding:${runId}`;
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
    | { ok: false; reason: 'invalid-binding' | 'wrong-player' | 'wrong-mission' | 'wrong-run' | 'expired' | 'already-settled' | 'not-complete' | 'not-won' | 'not-a-member' | 'reward-drift' };

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
        sessionId: params.sessionId ?? `mcombat-${randomUUID()}`,
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

export function validateCompletedMissionCombatSession(params: {
    binding: MissionCombatBinding | null | undefined;
    session: TowerSession | null | undefined;
    playerName: string;
    mission: CombatMissionDef;
    now?: number;
}): MissionCombatValidation {
    const { binding, session, playerName, mission } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.sessionId || !binding.runId) return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (binding.missionId !== mission.key || binding.enemyProfileId !== mission.aiProfileId) return { ok: false, reason: 'wrong-mission' };
    if (!session || binding.runId !== session.runId) return { ok: false, reason: 'wrong-run' };
    if (binding.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done') return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'squad') return { ok: false, reason: 'not-won' };
    if (!session.actors.some((actor) => actor.side === 'squad' && actor.ownerSlug === playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    if (binding.rewardFingerprint !== missionCombatRewardFingerprint(mission)) return { ok: false, reason: 'reward-drift' };
    return { ok: true, binding };
}

export function settleMissionCombatBinding(binding: MissionCombatBinding, now = Date.now()): MissionCombatBinding {
    if (binding.status !== 'active' || binding.settledAt) return binding;
    return { ...binding, status: 'won', settledAt: now };
}
