import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import type { AiFightProfile, AiFightScaling } from '../missions/_ai-fight-encounter.js';
import type { AiFightOutcome } from '../missions/_ai-fight-outcome.js';

export const DUNGEON_WARDEN_AUTHORITY_VERSION = 1;
export const DUNGEON_WARDEN_BASE_PROFILE_ID = 'boss-hollow-gate-warden';

export type DungeonAiFightAuthority = {
    battleKind: 'dungeon';
    opponentId: string;
    profile: AiFightProfile;
    scaling: AiFightScaling;
    dungeonRunToken: string;
};

function cleanRunToken(value: unknown): string {
    const token = typeof value === 'string' ? value.trim().slice(0, 80) : '';
    return /^[A-Za-z0-9_-]{8,80}$/.test(token) ? token : '';
}

function hash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

export function dungeonWardenTier(playerName: string, runToken: string): 50 | 75 | 100 {
    return ([50, 75, 100] as const)[hash(`${playerName.toLowerCase()}:${runToken}`) % 3]!;
}

/** Reconstruct the Warden from server-owned run authority. The request's
 * opponent id, level, stats, jutsu and reward fields are never consulted. */
export function resolveDungeonAiFightAuthority(params: {
    playerName: string;
    character: Record<string, unknown>;
    dungeonRunToken: unknown;
}): DungeonAiFightAuthority {
    const dungeonRunToken = cleanRunToken(params.dungeonRunToken);
    const active = params.character.activeDungeonRun && typeof params.character.activeDungeonRun === 'object'
        && !Array.isArray(params.character.activeDungeonRun)
        ? params.character.activeDungeonRun as Record<string, unknown>
        : null;
    if (!dungeonRunToken || !active || active.token !== dungeonRunToken) {
        throw new Error('A matching active Dungeon run is required for this Warden.');
    }
    if (active.wardenDefeated === true) {
        throw new Error('This Dungeon Warden was already defeated.');
    }
    if (active.entry === 'free' && typeof active.exploreReceiptId !== 'string') {
        throw new Error('The discovered Dungeon must be bound to its exploration receipt first.');
    }
    const base = AI_PROFILE_CATALOG[DUNGEON_WARDEN_BASE_PROFILE_ID];
    if (!base) throw new Error('The Dungeon Warden profile is unavailable.');
    const level = dungeonWardenTier(params.playerName, dungeonRunToken);
    const opponentId = `dungeon-warden-${level}`;
    const profile: AiFightProfile = {
        ...structuredClone(base),
        id: opponentId,
        name: level === 100 ? 'Abyssal Dungeon Warden'
            : level === 75 ? 'Sealed Dungeon Warden'
                : 'Dungeon Warden',
    };
    return {
        battleKind: 'dungeon',
        opponentId,
        profile,
        scaling: {
            level,
            statBonus: level === 100 ? 230 : level === 75 ? 175 : 130,
        },
        dungeonRunToken,
    };
}

/** Stamp only the exact active run represented by the sealed AI token. Loss,
 * draw and forfeit remain retryable but can never satisfy Dungeon settlement. */
export function applyDungeonWardenSettlement(params: {
    character: Record<string, unknown>;
    dungeonRunToken: unknown;
    opponentId: unknown;
    proofId: string;
    outcome: AiFightOutcome;
    now?: number;
}): { ok: true; character: Record<string, unknown> } | { ok: false; error: string } {
    const dungeonRunToken = cleanRunToken(params.dungeonRunToken);
    const active = params.character.activeDungeonRun && typeof params.character.activeDungeonRun === 'object'
        && !Array.isArray(params.character.activeDungeonRun)
        ? params.character.activeDungeonRun as Record<string, unknown>
        : null;
    if (!dungeonRunToken || !active || active.token !== dungeonRunToken) {
        return { ok: false, error: 'The sealed Warden fight no longer matches the active Dungeon run.' };
    }
    if (active.wardenDefeated === true) {
        return active.wardenProofId === params.proofId
            ? { ok: true, character: params.character }
            : { ok: false, error: 'This Dungeon Warden was already defeated by another sealed fight.' };
    }
    const nextRun: Record<string, unknown> = {
        ...active,
        combatAuthorityVersion: DUNGEON_WARDEN_AUTHORITY_VERSION,
        wardenLastOutcome: params.outcome,
        wardenLastProofId: params.proofId,
        wardenProfileId: typeof params.opponentId === 'string' ? params.opponentId : '',
        wardenSettledAt: params.now ?? Date.now(),
        ...(params.outcome === 'win' ? {
            wardenDefeated: true,
            wardenProofId: params.proofId,
            wardenDefeatedAt: params.now ?? Date.now(),
        } : {}),
    };
    return { ok: true, character: { ...params.character, activeDungeonRun: nextRun } };
}

export function dungeonWardenWasDefeated(active: Record<string, unknown> | null): boolean {
    return active?.combatAuthorityVersion === DUNGEON_WARDEN_AUTHORITY_VERSION
        && active.wardenDefeated === true
        && typeof active.wardenProofId === 'string'
        && /^[A-Za-z0-9]{8,96}$/.test(active.wardenProofId);
}
