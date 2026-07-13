import { MAX_AI_FIGHT_RYO, MAX_AI_FIGHT_XP } from './_ai-fight-reward.js';

export const AI_FIGHT_TOKEN_TTL_SECONDS = 20 * 60;

export type AiFightBattleKind = 'practice' | 'mission' | 'raidAi' | 'defense' | 'explore' | 'endless';

export type AiFightToken = {
    playerName: string;
    tokenId: string;
    mintedAt: number;
    maxXp: number;
    maxRyo: number;
    baseXp?: number;
    baseRyo?: number;
    rewardSource?: 'server-save' | 'legacy-client';
    opponentId?: string;
    opponentLevel?: number;
    battleKind?: AiFightBattleKind;
};

export type AiFightRewardClaim =
    | { ok: true; xp: number; ryo: number }
    | { ok: false; reason: 'invalid-ai-fight-token' | 'reward-exceeds-ai-fight-token' };

export function cleanAiFightToken(raw: unknown): string {
    const token = typeof raw === 'string' ? raw.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9]+$/.test(token) ? token : '';
}

export function aiFightTokenKey(playerName: string, token: string): string {
    return `ai-fight-token:${playerName}:${token}`;
}

export function createAiFightTokenRecord(
    playerName: string,
    tokenId: string,
    now = Date.now(),
    context: { opponentId?: unknown; opponentLevel?: unknown; baseXp?: unknown; baseRyo?: unknown; battleKind?: unknown } = {},
): AiFightToken {
    const opponentIdRaw = typeof context.opponentId === 'string' ? context.opponentId.trim().slice(0, 96) : '';
    const opponentId = /^[A-Za-z0-9:_-]+$/.test(opponentIdRaw) ? opponentIdRaw : undefined;
    const opponentLevelNum = Math.floor(Number(context.opponentLevel ?? 0));
    const opponentLevel = Number.isFinite(opponentLevelNum) && opponentLevelNum > 0
        ? Math.min(250, opponentLevelNum)
        : undefined;
    const baseXp = Math.max(0, Math.min(MAX_AI_FIGHT_XP, Math.floor(Number(context.baseXp ?? NaN))));
    const baseRyo = Math.max(0, Math.min(MAX_AI_FIGHT_RYO, Math.floor(Number(context.baseRyo ?? NaN))));
    const battleKindRaw = typeof context.battleKind === 'string' ? context.battleKind : '';
    const battleKind: AiFightBattleKind = battleKindRaw === 'mission'
        || battleKindRaw === 'raidAi'
        || battleKindRaw === 'defense'
        || battleKindRaw === 'explore'
        || battleKindRaw === 'endless'
        ? battleKindRaw
        : 'practice';
    return {
        playerName,
        tokenId,
        mintedAt: now,
        maxXp: MAX_AI_FIGHT_XP,
        maxRyo: MAX_AI_FIGHT_RYO,
        battleKind,
        ...(Number.isFinite(baseXp) ? { baseXp } : {}),
        ...(Number.isFinite(baseRyo) ? { baseRyo } : {}),
        ...(Number.isFinite(baseXp) && Number.isFinite(baseRyo) ? { rewardSource: 'server-save' as const } : {}),
        ...(opponentId ? { opponentId } : {}),
        ...(opponentLevel ? { opponentLevel } : {}),
    };
}

export function computeAiFightBaseReward(character: Record<string, unknown> | null | undefined): { xp: number; ryo: number; trait: string | null } {
    const pets = Array.isArray(character?.pets) ? character.pets as Array<Record<string, unknown>> : [];
    const activePet = pets.find((pet) => pet && pet.id === character?.activePetId);
    const trait = activePet && typeof activePet.trait === 'string' ? activePet.trait : null;
    return {
        xp: trait === 'Swift' ? 125 : 100,
        ryo: trait === 'Lucky' ? 90 : 75,
        trait,
    };
}

export function validateAiFightRewardClaim(token: AiFightToken | null | undefined, claimedXp: unknown, claimedRyo: unknown): AiFightRewardClaim {
    if (!token || !Number.isFinite(Number(token.maxXp)) || !Number.isFinite(Number(token.maxRyo))) {
        return { ok: false, reason: 'invalid-ai-fight-token' };
    }
    if (Number.isFinite(Number(token.baseXp)) && Number.isFinite(Number(token.baseRyo))) {
        const maxXp = Math.max(0, Math.floor(Number(token.maxXp) || 0));
        const maxRyo = Math.max(0, Math.floor(Number(token.maxRyo) || 0));
        return {
            ok: true,
            xp: Math.max(0, Math.min(maxXp, Math.floor(Number(token.baseXp) || 0))),
            ryo: Math.max(0, Math.min(maxRyo, Math.floor(Number(token.baseRyo) || 0))),
        };
    }
    const xp = Math.max(0, Math.floor(Number(claimedXp) || 0));
    const ryo = Math.max(0, Math.floor(Number(claimedRyo) || 0));
    const maxXp = Math.max(0, Math.floor(Number(token.maxXp) || 0));
    const maxRyo = Math.max(0, Math.floor(Number(token.maxRyo) || 0));
    if (xp > maxXp || ryo > maxRyo) {
        return { ok: false, reason: 'reward-exceeds-ai-fight-token' };
    }
    return { ok: true, xp, ryo };
}
