import type { WorldCrisisProjection } from "../../../shared/world-crisis";

export async function fetchWorldCrisis(): Promise<WorldCrisisProjection | null> {
    try {
        const response = await fetch("/api/world-crisis", { cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json() as { crisis?: WorldCrisisProjection };
        return payload.crisis ?? null;
    } catch {
        return null;
    }
}
