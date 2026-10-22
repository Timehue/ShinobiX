// The raw `progressionDials` object from the last game-state frame
// (api/game-state.ts). world-state.ts, which is in the startup bundle, only
// stores the payload here; lib/progression-dials.ts normalizes it for the lazy
// screens that read it, so the normalizer stays out of the initial graph.

let payload: unknown = null;

export function setSharedProgressionDialsPayload(value: unknown): void {
    payload = value ?? null;
}

export function sharedProgressionDialsPayload(): unknown {
    return payload;
}

// The last shared daily stat-point budget a server reply reported for a player
// (`statBudget` on a hunt / field claim: { day, spent, cap }). Raw, like the
// payload above; lib/progression-dials.ts validates it and drops a stale day.
let dailyStatBudget: { playerName: string; value: unknown } | null = null;

export function setSharedDailyStatBudget(playerName: string, value: unknown): void {
    if (value && typeof value === "object") dailyStatBudget = { playerName, value };
}

export function sharedDailyStatBudget(playerName: string): unknown {
    return dailyStatBudget && dailyStatBudget.playerName === playerName ? dailyStatBudget.value : null;
}
