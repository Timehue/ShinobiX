import type { WorldCrisis80Projection } from "../../../shared/world-crisis-80";
import type { ShowdownStateView } from "../../../shared/pet-showdown-contract";
import type { TowerHostLoadout, TowerSession } from "./towers-api";

async function jsonPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
    if (!response.ok || !payload) throw new Error(payload?.error ?? "The crisis authority did not answer.");
    return payload;
}

export async function fetchWorldCrisis80(): Promise<WorldCrisis80Projection | null> {
    try {
        const response = await fetch("/api/world-crisis-80", { cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json() as { crisis?: WorldCrisis80Projection };
        return payload.crisis ?? null;
    } catch {
        return null;
    }
}

export async function startWorldCrisis80Combat(input: {
    playerName: string;
    sourceId: string;
    requestId: string;
    hostLoadout?: TowerHostLoadout;
}): Promise<{ runId: string; session: TowerSession }> {
    return jsonPost("/api/world-crisis-80/combat-start", input);
}

export async function settleWorldCrisis80Combat(runId: string, playerName: string): Promise<unknown> {
    return jsonPost("/api/world-crisis-80/combat-settle", { runId, playerName });
}

export async function startWorldCrisis80PetBattle(input: {
    playerName: string;
    sourceId: string;
    petIds: string[];
}): Promise<{ state: ShowdownStateView }> {
    return jsonPost("/api/pet/showdown", { action: "world-crisis-80", ...input });
}
