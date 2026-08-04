import type { Character } from '../types/character';
import type { SoloPveSession } from './solo-pve-api';

export type HollowGateCombatKind = 'battle' | 'elite' | 'ambush' | 'beast' | 'boss';

export type HollowGateCombatRef = {
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
};

export type HollowGateServerFight = HollowGateCombatRef & { session: SoloPveSession };

export type HollowGateCombatStartResult = {
    ok: boolean;
    resumed?: boolean;
    runId: string;
    combatMode?: 'solo-pve' | 'pet';
    session?: SoloPveSession;
    error?: string;
};

export type HollowGateCombatSettleResult = {
    ok: boolean;
    won: boolean;
    revived?: boolean;
    escaped?: boolean;
    petDefeat?: boolean;
    alreadyReported?: boolean;
    reward?: Record<string, number>;
    elementalShards?: number;
    character?: Character | null;
    _saveVersion?: number;
    error?: string;
};

export async function startHollowGateCombat(params: {
    playerName: string;
    token: string;
    floor: number;
    nodeId: string;
    kind: HollowGateCombatKind;
    mode?: 'pve' | 'pet';
}): Promise<HollowGateCombatStartResult> {
    const response = await fetch('/api/hollow-gate/combat-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => ({})) as Partial<HollowGateCombatStartResult>;
    if (!response.ok || !data.runId) throw new Error(data.error ?? 'The Hollow Gate encounter could not start.');
    return data as HollowGateCombatStartResult;
}

export async function settleHollowGateCombat(params: {
    playerName: string;
    token: string;
    runId: string;
    petReceipt?: string;
}): Promise<HollowGateCombatSettleResult> {
    const response = await fetch('/api/hollow-gate/combat-settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => ({})) as Partial<HollowGateCombatSettleResult>;
    if (!response.ok || data.ok !== true || typeof data.won !== 'boolean') throw new Error(data.error ?? 'The Hollow Gate encounter could not settle.');
    return data as HollowGateCombatSettleResult;
}

export async function descendHollowGateRun(params: {
    playerName: string;
    token: string;
    fromFloor: number;
}): Promise<number> {
    const response = await fetch('/api/hollow-gate/descend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => ({})) as { ok?: boolean; floor?: number; error?: string };
    if (!response.ok || data.ok !== true || !Number.isFinite(data.floor)) {
        throw new Error(data.error ?? 'The Hollow Gate staircase could not seal the next floor.');
    }
    return Math.max(1, Math.floor(Number(data.floor)));
}
