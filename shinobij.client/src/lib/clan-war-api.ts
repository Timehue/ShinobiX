export const sharedClanWarCache: Record<string, CwWar> = {};

export type CwChallengeMode = "pvp1v1" | "pvp2v2" | "pet1v1" | "pet2v2" | "tilecards";
type CwChallengeStatus = "queuing" | "pending" | "accepted" | "completed" | "expired" | "cancelled";
export type CwChallengeResult = "from-wins" | "to-wins" | "draw";
export type CwChallenge = {
    id: string;
    mode: CwChallengeMode;
    fromClan: string;
    fromPlayer: string;
    fromPlayer2?: string;
    createdAt: number;
    status: CwChallengeStatus;
    expiresAt: number;
    acceptedAt?: number;
    acceptedPlayer?: string;
    acceptedPlayer2?: string;
    completedAt?: number;
    result?: CwChallengeResult;
    battleId?: string;
    petBattleSeed?: number;
    // Two-phase reporting: first reporter stamps a tentative result;
    // the opposing side has 15 min to confirm or dispute. After the
    // window, any participant re-calling report auto-confirms.
    tentativeResult?: CwChallengeResult;
    tentativeBy?: string;
    tentativeAt?: number;
};
export type CwWar = {
    id: string;
    clans: [string, string];
    villages: Record<string, string>;
    hp: Record<string, number>;
    hpMax?: Record<string, number>; // per-clan starting pool (base + War Room bonus)
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    winnerClan?: string;
    declaredBy: string;
    pendingChallenges: CwChallenge[];
    completedChallenges: CwChallenge[];
    warCrateId?: string;
    mvpByClan?: Record<string, string>;
};
// CW_HP_MAX / CW_DAMAGE / CW_MODE_LABEL / CW_MODE_ICON moved to ./constants/clan.

// Coalesce concurrent callers. Three pollers (App-level 30s + ClanWarsPanel 20s
// + ClanBattlesTab 15s, the latter two on separate screens) can overlap; without
// this each fires its own uncached origin fetch of the full war list. While a
// request is in flight, additional callers share it and receive identical data —
// behavior-identical to firing simultaneously, with no added staleness (the
// in-flight handle is cleared the moment it settles, so the next call is fresh).
let _cwListInFlight: Promise<CwWar[]> | null = null;
export async function cwListWars(): Promise<CwWar[]> {
    if (_cwListInFlight) return _cwListInFlight;
    _cwListInFlight = (async () => {
        try {
            const r = await fetch("/api/clan/war/list");
            if (!r.ok) return [];
            const data = await r.json() as { wars?: CwWar[] };
            const wars = data.wars ?? [];
            // Populate the shared cache so claimPendingWarCrates can scan
            // ended clan wars for unclaimed rewards on next render.
            for (const w of wars) sharedClanWarCache[w.id] = w;
            return wars;
        } catch { return []; }
    })();
    try { return await _cwListInFlight; }
    finally { _cwListInFlight = null; }
}
export async function cwDeclareWar(toClan: string): Promise<{ ok: boolean; error?: string; war?: CwWar }> {
    try {
        const r = await fetch("/api/clan/war/declare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toClan }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return { ok: false, error: data.error ?? `HTTP ${r.status}` };
        return { ok: true, war: data.war };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
export async function cwChallengeAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; war?: CwWar; challenge?: CwChallenge }> {
    try {
        const r = await fetch("/api/clan/war/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return { ok: false, error: data.error ?? `HTTP ${r.status}` };
        return { ok: true, war: data.war, challenge: data.challenge };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
