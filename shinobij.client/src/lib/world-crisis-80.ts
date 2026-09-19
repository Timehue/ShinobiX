import type { WorldCrisis80Projection } from "../../../shared/world-crisis-80";
import type { ShowdownStateView } from "../../../shared/pet-showdown-contract";
import type { TowerHostLoadout, TowerSession } from "./towers-api";
import { WORLD_CRISIS_FETCH_TIMEOUT_MS } from "./world-crisis";

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

/** `fresh` reads back the caller's own action; see fetchWorldCrisis. */
export async function fetchWorldCrisis80(options: { fresh?: boolean } = {}): Promise<WorldCrisis80Projection | null> {
    try {
        const response = await fetch(options.fresh ? "/api/world-crisis-80?fresh=1" : "/api/world-crisis-80", {
            cache: "no-store",
            signal: AbortSignal.timeout(WORLD_CRISIS_FETCH_TIMEOUT_MS),
        });
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
