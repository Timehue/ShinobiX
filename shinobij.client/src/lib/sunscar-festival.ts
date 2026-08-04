import type { Character } from "../types/character";

export const FATE_DICE_COST = 25;
export const FATE_DICE_DAILY_CAP = 5;

export type FateDiceSymbol = "scorpion" | "coin" | "eye" | "blade" | "moon" | "star";
export const FATE_DICE_GLYPHS: Record<FateDiceSymbol, string> = {
    scorpion: "🦂",
    coin: "🪙",
    eye: "👁️",
    blade: "⚔️",
    moon: "🌙",
    star: "⭐",
};

export type SunscarDiceResult = {
    ok: boolean;
    error?: string;
    roll?: FateDiceSymbol[];
    reward?: { ryo: number; xp: number; statPoints?: number; stamina: number; boneCharms: number; fateShards: number; auraStones: number };
    message?: string;
    dailyUsed?: number;
    dailyCap?: number;
    cost?: number;
    character?: Character;
};

export type MiraaOutcome = "win" | "loss" | "draw" | "forfeit";

// Opening a wager escrows the stake server-side and returns a single-use token
// that the settle call later redeems. The server, not the client, decides the
// outcome — see reportMiraaWager.
export type MiraaStartResult = {
    ok: boolean;
    error?: string;
    token?: string;
    bet?: number;
    balanceRyo?: number;
    character?: Character;
};

export type MiraaResult = {
    ok: boolean;
    error?: string;
    outcome?: MiraaOutcome;
    bet?: number;
    /** Ryo credited back on this settle (0 on a loss/forfeit; 2×bet on a win). */
    credit?: number;
    balanceRyo?: number;
    character?: Character;
};

async function postSunscar<T>(body: Record<string, unknown>, fallback: string): Promise<T & { ok: boolean; error?: string }> {
    try {
        const res = await fetch("/api/festival/sunscar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({})) as T & { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || fallback };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "Festival action unconfirmed. Refresh before retrying." } as T & { ok: boolean; error?: string };
    }
}

export function rollFateDice(playerName: string): Promise<SunscarDiceResult> {
    return postSunscar<SunscarDiceResult>({ kind: "dice", playerName }, "The dice refuse to roll. Try again.");
}

/** Open a Miraa wager: the server escrows the stake and mints a single-use token. */
export function startMiraaWager(playerName: string, bet: number): Promise<MiraaStartResult> {
    const requestId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `miraa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return postSunscar<MiraaStartResult>({ kind: "miraa-start", playerName, bet, requestId }, "Miraa won't take that wager. Try again.");
}

/**
 * Settle an opened wager. The server rolls the outcome from the sealed bet — the
 * client-side card result never decides the ryo, it only distinguishes a played-
 * out match from a forfeit (leaving mid-match keeps the stake with Miraa).
 */
export function reportMiraaWager(playerName: string, token: string, forfeit = false): Promise<MiraaResult> {
    return postSunscar<MiraaResult>({ kind: "miraa-report", playerName, token, forfeit }, "Miraa's verdict slipped into the sands. Refresh before retrying.");
}
