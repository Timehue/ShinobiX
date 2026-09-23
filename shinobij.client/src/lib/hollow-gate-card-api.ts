import type { Character } from "../types/character";

type CardStartResult = { ok: boolean; matchId?: string; error?: string };
type CardSettleResult = { ok: boolean; won?: boolean; reward?: { ryo: number; auraDust: number }; character?: Character; _saveVersion?: number; error?: string };

export async function startHollowGateCardAmbush(playerName: string, token: string, nodeId: string): Promise<CardStartResult> {
    try {
        const response = await fetch("/api/hollow-gate/card-start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, nodeId }),
        });
        const data = await response.json().catch(() => ({})) as CardStartResult;
        return response.ok && data.ok ? data : { ...data, ok: false, error: data.error ?? "The rift card ambush could not start." };
    } catch {
        return { ok: false, error: "The rift card service is unreachable." };
    }
}

export async function settleHollowGateCardAmbush(playerName: string, token: string, matchId: string): Promise<CardSettleResult> {
    try {
        const response = await fetch("/api/hollow-gate/card-settle", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, matchId }),
        });
        const data = await response.json().catch(() => ({})) as CardSettleResult;
        return response.ok && data.ok ? data : { ...data, ok: false, error: data.error ?? "The rift card result could not be sealed." };
    } catch {
        return { ok: false, error: "The rift card service is unreachable." };
    }
}
