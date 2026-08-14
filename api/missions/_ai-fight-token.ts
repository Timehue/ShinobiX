import { MAX_AI_FIGHT_RYO, MAX_AI_FIGHT_XP } from './_ai-fight-reward.js';
import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';

// Matches the active Solo-PvE session lifetime so a terminal fight never loses
// its settlement/reconnect authority during the final ten minutes.
export const AI_FIGHT_TOKEN_TTL_SECONDS = 30 * 60;

export type AiFightBattleKind = 'practice' | 'mission' | 'raidAi' | 'defense' | 'explore' | 'endless' | 'world' | 'dungeon';

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
    sector?: number;
    /** Exact World exploration result that authorized this generic ambush. */
    worldExploreRequestId?: string;
    /** Exact raid-start authority reserved to this standalone session. */
    raidTokenId?: string;
    /** Exact active Dungeon run whose Warden this session represents. */
    dungeonRunToken?: string;
    battleKind?: AiFightBattleKind;
    /** New normal-solo authority binding. Explicit runtime discrimination keeps
     * a solo session id from ever being interpreted as a Tower run id. */
    sessionRuntime?: 'solo-pve';
    sessionId?: string;
    /** Server-reconstructed World Map identity. Never copied from the request. */
    worldContext?: WorldAiFightContext;
    /** Exact start metadata + versioned non-evicting redemption authority. */
    rewardTrait?: string;
    redemptionAuthorityVersion?: 1;
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
    context: { opponentId?: unknown; opponentLevel?: unknown; sector?: unknown; worldExploreRequestId?: unknown; raidTokenId?: unknown; dungeonRunToken?: unknown; baseXp?: unknown; baseRyo?: unknown; battleKind?: unknown; sessionRuntime?: unknown; sessionId?: unknown; worldContext?: WorldAiFightContext; rewardTrait?: unknown } = {},
): AiFightToken {
    const sessionIdRaw = typeof context.sessionId === 'string' ? context.sessionId.trim().slice(0, 96) : '';
    const sessionId = /^[A-Za-z0-9:_-]+$/.test(sessionIdRaw) ? sessionIdRaw : undefined;
    const sessionRuntime = context.sessionRuntime === 'solo-pve' && sessionId ? 'solo-pve' as const : undefined;
    const opponentIdRaw = typeof context.opponentId === 'string' ? context.opponentId.trim().slice(0, 96) : '';
    const opponentId = /^[A-Za-z0-9:_-]+$/.test(opponentIdRaw) ? opponentIdRaw : undefined;
    const opponentLevelNum = Math.floor(Number(context.opponentLevel ?? 0));
    const opponentLevel = Number.isFinite(opponentLevelNum) && opponentLevelNum > 0
        ? Math.min(250, opponentLevelNum)
        : undefined;
    const sectorNum = Math.floor(Number(context.sector));
    const sector = Number.isSafeInteger(sectorNum) && sectorNum >= 1 && sectorNum <= 66 ? sectorNum : undefined;
    const baseXp = Math.max(0, Math.min(MAX_AI_FIGHT_XP, Math.floor(Number(context.baseXp ?? NaN))));
    const baseRyo = Math.max(0, Math.min(MAX_AI_FIGHT_RYO, Math.floor(Number(context.baseRyo ?? NaN))));
    const battleKindRaw = typeof context.battleKind === 'string' ? context.battleKind : '';
    const battleKind: AiFightBattleKind = battleKindRaw === 'mission'
        || battleKindRaw === 'raidAi'
        || battleKindRaw === 'defense'
        || battleKindRaw === 'explore'
        || battleKindRaw === 'endless'
        || battleKindRaw === 'world'
        || battleKindRaw === 'dungeon'
        ? battleKindRaw
        : 'practice';
    const rewardTrait = typeof context.rewardTrait === 'string' && context.rewardTrait.trim()
        ? context.rewardTrait.trim().slice(0, 64)
        : undefined;
    const worldExploreRequestIdRaw = typeof context.worldExploreRequestId === 'string'
        ? context.worldExploreRequestId.trim().slice(0, 96)
        : '';
    const worldExploreRequestId = /^[A-Za-z0-9_-]{8,96}$/.test(worldExploreRequestIdRaw)
        ? worldExploreRequestIdRaw
        : undefined;
    const raidTokenIdRaw = typeof context.raidTokenId === 'string' ? context.raidTokenId.trim().slice(0, 96) : '';
    const raidTokenId = /^[A-Za-z0-9_-]{8,96}$/.test(raidTokenIdRaw) ? raidTokenIdRaw : undefined;
    const dungeonRunTokenRaw = typeof context.dungeonRunToken === 'string' ? context.dungeonRunToken.trim().slice(0, 80) : '';
    const dungeonRunToken = /^[A-Za-z0-9_-]{8,80}$/.test(dungeonRunTokenRaw) ? dungeonRunTokenRaw : undefined;
    return {
        playerName,
        tokenId,
        mintedAt: now,
        maxXp: MAX_AI_FIGHT_XP,
        maxRyo: MAX_AI_FIGHT_RYO,
        battleKind,
        redemptionAuthorityVersion: 1,
        ...(Number.isFinite(baseXp) ? { baseXp } : {}),
        ...(Number.isFinite(baseRyo) ? { baseRyo } : {}),
        ...(Number.isFinite(baseXp) && Number.isFinite(baseRyo) ? { rewardSource: 'server-save' as const } : {}),
        ...(opponentId ? { opponentId } : {}),
        ...(opponentLevel ? { opponentLevel } : {}),
        ...(sector ? { sector } : {}),
        ...(worldExploreRequestId ? { worldExploreRequestId } : {}),
        ...(raidTokenId ? { raidTokenId } : {}),
        ...(dungeonRunToken ? { dungeonRunToken } : {}),
        ...(sessionRuntime && sessionId ? { sessionRuntime, sessionId } : {}),
        ...(rewardTrait ? { rewardTrait } : {}),
        ...(context.worldContext ? { worldContext: structuredClone(context.worldContext) } : {}),
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
