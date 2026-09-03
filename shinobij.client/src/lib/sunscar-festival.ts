import type { Character } from "../types/character";

// MIRROR: api/festival/_sunscar.ts FATE_DICE_DAILY_CAP. The dice used to cost
// 250 ryo; the draw is FREE as of 2026-09-03 (the staked version was removed
// for the Play content rating), so there is no price left to display.
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
    _saveVersion?: unknown;
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

// REMOVED 2026-09-03: startMiraaWager / reportMiraaWager. Miraa took an
// even-money ryo bet on a Card Clash match settled by a server-rolled die; the
// wager was removed for the Play content rating and the match is now free.
// `miraa-report` still exists SERVER-side purely to refund a stake that was
// already escrowed when the removal shipped — a stale cached client calls it,
// this one never does.
