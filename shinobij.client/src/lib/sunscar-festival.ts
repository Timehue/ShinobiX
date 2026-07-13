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
    reward?: { ryo: number; xp: number; stamina: number; boneCharms: number; fateShards: number; auraStones: number };
    message?: string;
    dailyUsed?: number;
    dailyCap?: number;
    cost?: number;
    character?: Character;
};

export type MiraaOutcome = "win" | "loss" | "draw" | "forfeit";
export type MiraaResult = {
    ok: boolean;
    error?: string;
    bet?: number;
    outcome?: MiraaOutcome;
    delta?: number;
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

export function settleMiraaWager(playerName: string, bet: number, outcome: MiraaOutcome): Promise<MiraaResult> {
    return postSunscar<MiraaResult>({ kind: "miraa", playerName, bet, outcome }, "Miraa slips the wager back into the sands. Try again.");
}
