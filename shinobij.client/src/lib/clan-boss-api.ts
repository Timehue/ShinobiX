/*
 * Client wrappers for the Weekly Clan Boss Gauntlet (api/clan-boss/*). An assault
 * reuses the Battle-Towers fight screen; only start + settle are clan-boss-specific
 * (the server computes damage and banks it into the clan pool). Auth headers are
 * attached by the global fetch interceptor. Gated behind the clanBoss.v1 flag.
 */
import type { TowerSession, TowerHostLoadout } from "./towers-api";

export type ClanBossStanding = { clanName: string; score: number; killed: boolean; rank: number };
export type ClanBossMyClan = {
    clanName: string; pool: number; poolMax: number; killed: boolean; damageDealt: number;
    participants: number; attemptsPerMember: number; myAttemptsLeft: number; rank: number | null; score: number;
};
export type ClanBossView = {
    ok: boolean;
    active: boolean;
    weekId?: string;
    endsAt?: number;
    boss?: { id: string; name: string; icon: string; flavor: string; mechanic: string } | null;
    inClan?: boolean;
    myClan?: ClanBossMyClan | null;
    standings?: ClanBossStanding[];
};

/** UI gate — the Clan Boss tab only shows when this flag is set. Default OFF. */
export function clanBossEnabled(): boolean {
    try { return typeof localStorage !== "undefined" && localStorage.getItem("clanBoss.v1") === "1"; }
    catch { return false; }
}

export async function fetchClanBoss(player: string): Promise<ClanBossView | null> {
    try {
        const r = await fetch(`/api/clan-boss/get?player=${encodeURIComponent(player)}`);
        if (!r.ok) return null;
        return (await r.json()) as ClanBossView;
    } catch { return null; }
}

export type ClanBossStartResult =
    | { runId: string; session: TowerSession; boss?: { id: string; name: string; icon: string } }
    | { error: string };

export async function startClanBossAssault(hostName: string, allies: string[], hostLoadout?: TowerHostLoadout): Promise<ClanBossStartResult> {
    try {
        const r = await fetch("/api/clan-boss/assault-start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hostName, allies, hostLoadout }),
        });
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        if (!r.ok) return { error: (data.error as string) ?? `HTTP ${r.status}` };
        return data as ClanBossStartResult;
    } catch (e) { return { error: String((e as Error).message) }; }
}

/** Bank a finished assault (used as BattleTowerFight's settleFn). Idempotent server-side. */
export async function settleClanBossAssault(runId: string, playerName: string): Promise<unknown> {
    try {
        const r = await fetch("/api/clan-boss/assault-settle", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId, playerName }),
        });
        return await r.json().catch(() => ({}));
    } catch { return null; }
}
