export type CardClashAiResult = 'player' | 'opponent' | 'draw';

/**
 * Card Clash vs the AI is a SPAR and pays nothing.
 *
 * Owner rule (2026-08): sparring of any kind against AI pays no rewards —
 * only world events, wandering AI, PvP, and missions pay. This table used to
 * be 50 / 15 / 5 ryo with a 250-ryo first-win-of-the-day bonus; it is kept
 * (zeroed) so the endpoint, the settlement receipt, and the client's
 * `reward` shape keep working unchanged. W/L/D records still advance.
 */
export const CARD_CLASH_AI_BASE_RYO: Record<CardClashAiResult, number> = {
    player: 0,
    draw: 0,
    opponent: 0,
};

export const CARD_CLASH_AI_DAILY_WIN_BONUS_RYO = 0;
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

/**
 * Always `{ ryo: 0, dailyBonus: false }` — an AI spar never pays and never
 * consumes the daily-bonus stamp. The signature is unchanged so callers and
 * the settlement receipt shape stay stable.
 */
export function cardClashAiReward(_result: CardClashAiResult, _alreadyWonToday: boolean): { ryo: number; dailyBonus: boolean } {
    return { ryo: 0, dailyBonus: false };
}
