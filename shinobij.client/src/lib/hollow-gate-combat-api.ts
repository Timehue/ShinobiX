import type { Character } from '../types/character';
import type { TowerHostLoadout, TowerSession } from './towers-api';

export type HollowGateCombatKind = 'battle' | 'elite' | 'ambush' | 'beast' | 'boss';

export type HollowGateCombatRef = {
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
};

export type HollowGateCombatStartResult = {
    ok: boolean;
    resumed?: boolean;
    runId: string;
    session: TowerSession;
    petAssisted?: boolean;
    error?: string;
};

export type HollowGateCombatSettleResult = {
    ok: boolean;
    won: boolean;
    revived?: boolean;
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
    hostLoadout?: TowerHostLoadout;
}): Promise<HollowGateCombatStartResult> {
    const response = await fetch('/api/hollow-gate/combat-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => ({})) as Partial<HollowGateCombatStartResult>;
    if (!response.ok || !data.runId || !data.session) throw new Error(data.error ?? 'The Hollow Gate encounter could not start.');
    return data as HollowGateCombatStartResult;
}

export async function settleHollowGateCombat(params: {
    playerName: string;
    token: string;
    runId: string;
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
