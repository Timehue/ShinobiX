import type { Character } from "../types/character";
import type { SoloPveSession } from "./solo-pve-api";

export type AiFightBattleKind = "practice" | "mission" | "raidAi" | "defense" | "explore" | "endless";

export type AiFightStart = { token: string; sessionId: string; session: SoloPveSession };

/** Start a mandatory server-owned generic AI encounter. */
export async function startAiFight(params: {
    playerName: string;
    opponentId: string;
    opponentLevel: number;
    battleKind: AiFightBattleKind;
}): Promise<AiFightStart> {
    const response = await fetch("/api/missions/ai-fight-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            playerName: params.playerName,
            opponentId: params.opponentId,
            opponentLevel: params.opponentLevel,
            battleKind: params.battleKind,
        }),
    });
    const data = await response.json().catch(() => ({})) as Partial<AiFightStart> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `AI fight start failed (${response.status}).`);
    if (!data.token || !data.sessionId || !data.session || data.session.runtime !== "solo-pve") {
        throw new Error("The combat server returned an incomplete solo-PvE session.");
    }
    return { token: data.token, sessionId: data.sessionId, session: data.session };
}

export type AiFightReportResult = {
    ok: boolean;
    outcome?: "win" | "loss" | "draw" | "forfeit";
    xp: number;
    ryo: number;
    capped?: boolean;
    replayed?: boolean;
    character?: Partial<Character>;
    _saveVersion?: number;
};

/** Redeem a token whose outcome and costs come only from its sealed session. */
export async function reportAiFightWin(playerName: string, token: string): Promise<AiFightReportResult | null> {
    if (!token) return null;
    try {
        const response = await fetch("/api/missions/report-ai-fight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, aiFightToken: token }),
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null) as AiFightReportResult | null;
        return data?.ok ? data : null;
    } catch {
        return null;
    }
}
