export type CardClashAiResult = 'player' | 'opponent' | 'draw';

export const CARD_CLASH_AI_BASE_RYO: Record<CardClashAiResult, number> = {
    player: 50,
    draw: 15,
    opponent: 5,
};

export const CARD_CLASH_AI_DAILY_WIN_BONUS_RYO = 250;
export const CARD_CLASH_AI_MIN_WIN_DURATION_MS = 15_000;
export const CARD_CLASH_AI_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export type CardClashAiToken = {
    matchId: string;
    playerName: string;
    createdAt: number;
    settledAt?: number;
};

export function cardClashAiTokenKey(matchId: string): string {
    return `cc-ai:${matchId}`;
}

export function cleanCardClashAiResult(raw: unknown): CardClashAiResult | null {
    const result = String(raw ?? '');
    return result === 'player' || result === 'opponent' || result === 'draw' ? result : null;
}

export function utcDateKey(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

export function cardClashAiReward(result: CardClashAiResult, alreadyWonToday: boolean): { ryo: number; dailyBonus: boolean } {
    const dailyBonus = result === 'player' && !alreadyWonToday;
    return {
        ryo: CARD_CLASH_AI_BASE_RYO[result] + (dailyBonus ? CARD_CLASH_AI_DAILY_WIN_BONUS_RYO : 0),
        dailyBonus,
    };
}
