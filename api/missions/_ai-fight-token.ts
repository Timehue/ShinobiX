import { MAX_AI_FIGHT_RYO, MAX_AI_FIGHT_XP } from './_ai-fight-reward.js';

export const AI_FIGHT_TOKEN_TTL_SECONDS = 20 * 60;

export type AiFightToken = {
    playerName: string;
    tokenId: string;
    mintedAt: number;
    maxXp: number;
    maxRyo: number;
    opponentId?: string;
    opponentLevel?: number;
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
    context: { opponentId?: unknown; opponentLevel?: unknown } = {},
): AiFightToken {
    const opponentIdRaw = typeof context.opponentId === 'string' ? context.opponentId.trim().slice(0, 96) : '';
    const opponentId = /^[A-Za-z0-9:_-]+$/.test(opponentIdRaw) ? opponentIdRaw : undefined;
    const opponentLevelNum = Math.floor(Number(context.opponentLevel ?? 0));
    const opponentLevel = Number.isFinite(opponentLevelNum) && opponentLevelNum > 0
        ? Math.min(250, opponentLevelNum)
        : undefined;
    return {
        playerName,
        tokenId,
        mintedAt: now,
        maxXp: MAX_AI_FIGHT_XP,
        maxRyo: MAX_AI_FIGHT_RYO,
        ...(opponentId ? { opponentId } : {}),
        ...(opponentLevel ? { opponentLevel } : {}),
    };
}

export function validateAiFightRewardClaim(token: AiFightToken | null | undefined, claimedXp: unknown, claimedRyo: unknown): AiFightRewardClaim {
    if (!token || !Number.isFinite(Number(token.maxXp)) || !Number.isFinite(Number(token.maxRyo))) {
        return { ok: false, reason: 'invalid-ai-fight-token' };
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
