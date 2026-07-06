import type { Character } from "../types/character";
import type { CardClashResult } from "./card-clash";

export type CardClashAiStartResult = {
    ok: boolean;
    error?: string;
    matchId?: string;
    createdAt?: number;
};

export type CardClashAiSettleResult = {
    ok: boolean;
    error?: string;
    result?: CardClashResult;
    ryo?: number;
    dailyBonus?: boolean;
    quickWin?: boolean;
    character?: Character;
};

export async function startCardClashAiMatch(playerName: string): Promise<CardClashAiStartResult> {
    try {
        const res = await fetch("/api/card-clash/ai-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        const data = await res.json().catch(() => ({})) as CardClashAiStartResult;
        if (!res.ok || !data.ok || !data.matchId) return { ...data, ok: false, error: data.error || "Could not start a Card Clash match." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "Could not start a Card Clash match." };
    }
}

export async function settleCardClashAiMatch(
    playerName: string,
    matchId: string,
    result: CardClashResult,
): Promise<CardClashAiSettleResult> {
    try {
        const res = await fetch("/api/card-clash/ai-settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, matchId, result }),
        });
        const data = await res.json().catch(() => ({})) as CardClashAiSettleResult;
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || "Could not settle the Card Clash reward." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "Could not settle the Card Clash reward." };
    }
}
