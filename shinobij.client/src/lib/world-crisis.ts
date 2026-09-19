import type { WorldCrisisProjection } from "../../../shared/world-crisis";

/** A hung read must end, or it holds up every later tick of the poll that made it. */
export const WORLD_CRISIS_FETCH_TIMEOUT_MS = 10_000;

/**
 * `fresh` is for reading back the caller's own action (a won defense): it
 * skips the few seconds the edge may hold the shared copy (api/world-crisis.ts).
 */
export async function fetchWorldCrisis(options: { fresh?: boolean } = {}): Promise<WorldCrisisProjection | null> {
    try {
        const response = await fetch(options.fresh ? "/api/world-crisis?fresh=1" : "/api/world-crisis", {
            cache: "no-store",
            signal: AbortSignal.timeout(WORLD_CRISIS_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const payload = await response.json() as { crisis?: WorldCrisisProjection };
        return payload.crisis ?? null;
    } catch {
        return null;
    }
}
