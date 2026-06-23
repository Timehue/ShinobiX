/*
 * Client wrapper for the server-authoritative daily login-streak claim.
 * Auth rides the global authFetch interceptor, so a bare /api fetch is signed.
 */

export interface DailyLoginResult {
    ok: boolean;
    alreadyClaimed: boolean;
    streak: number;
    granted: { ryo: number; fateShards: number };
    shardInterval: number;
    daysUntilShardBonus: number;
}

export async function claimDailyLogin(playerName: string): Promise<DailyLoginResult | null> {
    try {
        const r = await fetch("/api/player/daily-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        if (!r.ok) return null;
        const data = (await r.json()) as DailyLoginResult;
        return data && data.ok ? data : null;
    } catch {
        return null;
    }
}
