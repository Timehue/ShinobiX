export type VillageGuard = { name: string; level: number; village: string; defenseBonusPercent?: number };

/** Read-only guard presentation; the caller owns cancellation and late-result checks. */
export async function fetchVillageGuards(village: string, signal: AbortSignal): Promise<VillageGuard[]> {
    const response = await fetch('/api/village-guard/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ village }),
        signal,
    });
    return response.ok ? response.json() : [];
}

export type VillageGuardPostAnswer =
    | { kind: "duel"; guard: unknown }
    | { kind: "garrison" }
    | { kind: "refused"; message: string };

const POST_UNREACHABLE = "The village guard post could not be reached. Try again in a moment.";

/**
 * Who answers a raid. The server names a guard only when this raider can really
 * fight them, so a name on the roster is never enough to start a duel: every
 * other 200 means the garrison. A refused or failed request starts nothing.
 */
export async function askVillageGuardPost(
    body: { attackerCharacter: unknown; village: string; guardName: string },
    fetchFn: typeof fetch = fetch,
): Promise<VillageGuardPostAnswer> {
    try {
        const response = await fetchFn("/api/village-guard/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({})) as { pvp?: boolean; guardCharacter?: unknown; error?: string };
        if (!response.ok) return { kind: "refused", message: data.error || POST_UNREACHABLE };
        return data.pvp && data.guardCharacter ? { kind: "duel", guard: data.guardCharacter } : { kind: "garrison" };
    } catch {
        return { kind: "refused", message: POST_UNREACHABLE };
    }
}
