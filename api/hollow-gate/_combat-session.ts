import { createHash, randomUUID } from 'node:crypto';
import type { TowerSession } from '../towers/_tower-session.js';

export const HOLLOW_GATE_COMBAT_TTL_SECONDS = 24 * 60 * 60;
export const HOLLOW_GATE_MAX_COMBATS_PER_FLOOR = 16;

export type HollowGateCombatKind = 'battle' | 'elite' | 'ambush' | 'beast' | 'boss';

export interface HollowGateActiveEncounter {
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
    enemyProfileId: string;
    createdAt: number;
}

export interface HollowGateCombatBinding extends HollowGateActiveEncounter {
    version: 1;
    playerName: string;
    tokenDigest: string;
    status: 'active' | 'won' | 'lost';
    secondWindArmed?: boolean;
    petAssisted?: boolean;
    settledAt?: number;
}

export type HollowGateCombatReward = {
    xp: number;
    ryo: number;
    auraDust: number;
    honorSeals: number;
    boneCharms: number;
    fateShards: number;
    hollowShards: number;
    fragments: number;
    veils: number;
};

export function hollowGateCombatBindingKey(runId: string): string {
    return `hg-combat-binding:${runId}`;
}

export function isHollowGateCombatKind(value: unknown): value is HollowGateCombatKind {
    return value === 'battle' || value === 'elite' || value === 'ambush' || value === 'beast' || value === 'boss';
}

export function normalizeHollowGateNodeId(value: unknown): string {
    const nodeId = String(value ?? '').slice(0, 96);
    return /^floor:\d{1,2}:(?:tile:\d{1,5}|ambush:[a-zA-Z0-9_-]{1,48})$/.test(nodeId) ? nodeId : '';
}

export function hollowGateEncounterKey(floor: number, kind: HollowGateCombatKind, nodeId: string): string {
    return `${Math.floor(floor)}:${kind}:${nodeId}`;
}

export function hollowGateEnemyProfileId(floor: number, kind: HollowGateCombatKind): string {
    return `hollow-gate-${kind}-f${Math.max(1, Math.floor(floor))}`;
}

export function createHollowGateCombatBinding(params: {
    playerName: string;
    token: string;
    floor: number;
    nodeId: string;
    kind: HollowGateCombatKind;
    now?: number;
    runId?: string;
    secondWindArmed?: boolean;
    petAssisted?: boolean;
}): HollowGateCombatBinding {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        runId: params.runId ?? `hgcombat-${randomUUID().replace(/-/g, '')}`,
        playerName: params.playerName,
        tokenDigest: createHash('sha256').update(params.token).digest('hex'),
        floor: Math.max(1, Math.floor(params.floor)),
        nodeId: params.nodeId,
        kind: params.kind,
        enemyProfileId: hollowGateEnemyProfileId(params.floor, params.kind),
        createdAt: now,
        status: 'active',
        ...(params.secondWindArmed ? { secondWindArmed: true } : {}),
        ...(params.petAssisted ? { petAssisted: true } : {}),
    };
}

export type HollowGateCombatValidation =
    | { ok: true; binding: HollowGateCombatBinding }
    | { ok: false; reason: 'invalid-binding' | 'wrong-player' | 'wrong-run' | 'wrong-token' | 'binding-drift' | 'not-complete' | 'not-a-member' | 'already-settled' };

export function validateHollowGateCombatSession(params: {
    binding: HollowGateCombatBinding | null | undefined;
    session: TowerSession | null | undefined;
    activeEncounter: HollowGateActiveEncounter | null | undefined;
    playerName: string;
    token: string;
}): HollowGateCombatValidation {
    const { binding, session, activeEncounter, playerName, token } = params;
    if (!binding || binding.version !== 1 || !binding.runId || !binding.nodeId) return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (binding.tokenDigest !== createHash('sha256').update(token).digest('hex')) return { ok: false, reason: 'wrong-token' };
    if (!session || session.runId !== binding.runId) return { ok: false, reason: 'wrong-run' };
    if (!activeEncounter || activeEncounter.runId !== binding.runId) return { ok: false, reason: 'wrong-run' };
    if (activeEncounter.nodeId !== binding.nodeId
        || activeEncounter.floor !== binding.floor
        || activeEncounter.kind !== binding.kind
        || activeEncounter.enemyProfileId !== binding.enemyProfileId) {
        return { ok: false, reason: 'binding-drift' };
    }
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done') return { ok: false, reason: 'not-complete' };
    if (!session.actors.some((actor) => actor.side === 'squad' && actor.ownerSlug === playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    return { ok: true, binding };
}

export function settleHollowGateCombatBinding(binding: HollowGateCombatBinding, won: boolean, now = Date.now()): HollowGateCombatBinding {
    if (binding.status !== 'active' || binding.settledAt) return binding;
    return { ...binding, status: won ? 'won' : 'lost', settledAt: now };
}

export function hollowGatePostWinHp(maxHpRaw: unknown, survivingHpRaw: unknown, kind: HollowGateCombatKind): number {
    const maxHp = Math.max(1, Math.floor(Number(maxHpRaw) || 1));
    const survivingHp = Math.max(1, Math.floor(Number(survivingHpRaw) || 1));
    return Math.min(maxHp, survivingHp + (kind === 'boss' ? 60 : 20));
}

export function hollowGateCombatReward(floorRaw: number, kind: HollowGateCombatKind, profession?: unknown): HollowGateCombatReward {
    const floor = Math.max(1, Math.min(9, Math.floor(Number(floorRaw) || 1)));
    const boss = kind === 'boss';
    const ambush = kind === 'ambush';
    const depthMult = boss ? 1 + Math.max(0, floor - 1) * 0.2 : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (600/220/140 × depth) folds into ryo at ~0.75:1; loot lines unchanged.
    const baseXp = boss ? 600 : ambush ? 220 : 140;
    const baseRyo = (boss ? 2400 : ambush ? 900 : 380) + Math.floor(baseXp * 0.75);
    const baseDust = boss ? 30 : ambush ? 10 : 5;
    const encounterHonor = boss ? Math.floor(25 * depthMult) : 0;
    // The shipped final-clear modal paid these in addition to the boss drop.
    // Boss combat is only admitted on the sealed final floor, so bank the same
    // totals here instead of trusting a second client-side reward click.
    const clearHonor = boss ? 75 : 0;
    return {
        xp: 0, // retired — kept in the shape for old clients
        ryo: Math.floor(baseRyo * depthMult),
        auraDust: Math.floor(baseDust * depthMult),
        honorSeals: profession === 'vanguard' ? encounterHonor + clearHonor : 0,
        boneCharms: (encounterHonor > 0 ? Math.max(1, Math.floor(encounterHonor / 8)) : 0)
            + (clearHonor > 0 ? Math.max(1, Math.floor(clearHonor / 8)) : 0),
        fateShards: Math.floor(encounterHonor / 25)
            + (clearHonor > 0 ? 1 + Math.floor(clearHonor / 25) : 0),
        hollowShards: boss ? 15 + floor * 5 : 0,
        fragments: boss ? 2 : 0,
        veils: boss ? 1 : 0,
    };
}
