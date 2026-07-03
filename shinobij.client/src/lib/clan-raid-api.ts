/*
 * Client wrappers for the weekly Clan Raid Boss (api/clan/raid/*). The server is
 * fully authoritative — it computes strike damage from the caller's saved stats
 * and pays rewards from each member's damage share — so these are thin fetches.
 * Auth headers are attached by the global fetch interceptor (same as the other
 * clan endpoints). Gated behind the clanRaid.v1 flag (default OFF).
 */

export type RaidBossInfo = { id: string; name: string; icon: string; flavor: string };
export type RaidLeaderEntry = { slug: string; name: string; damage: number; attemptsUsed: number };
export type RaidView = {
    weekId: string;
    boss: RaidBossInfo;
    hp: number;
    hpMax: number;
    killedAt: number | null;
    killedBy: string | null;
    memberCountAtStart: number;
    leaderboard: RaidLeaderEntry[];
    me: { attemptsUsed: number; attemptsLeft: number; damage: number; claimed: boolean; canClaim: boolean };
};
export type RaidGetResult = { ok: boolean; inClan: boolean; raid: RaidView | null };

/** UI gate — the Raid tab only shows when this flag is set. Default OFF. */
export function clanRaidEnabled(): boolean {
    try { return typeof localStorage !== "undefined" && localStorage.getItem("clanRaid.v1") === "1"; }
    catch { return false; }
}

export async function fetchClanRaid(player: string): Promise<RaidGetResult | null> {
    try {
        const r = await fetch(`/api/clan/raid/get?player=${encodeURIComponent(player)}`);
        if (!r.ok) return null;
        return (await r.json()) as RaidGetResult;
    } catch { return null; }
}

export type RaidAttackResult = {
    ok: boolean; error?: string;
    damage?: number; crit?: boolean; hp?: number; hpMax?: number;
    killed?: boolean; alreadyDefeated?: boolean; bossName?: string;
    myDamage?: number; attemptsLeft?: number;
};
export async function clanRaidAttack(playerName: string): Promise<RaidAttackResult> {
    try {
        const r = await fetch("/api/clan/raid/attack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        if (!r.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${r.status}` };
        return { ok: true, ...data };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}

export type RaidClaimResult = { ok: boolean; error?: string; ryo?: number; contrib?: number; clanXp?: number; treasuryRyo?: number };
export async function clanRaidClaim(playerName: string): Promise<RaidClaimResult> {
    try {
        const r = await fetch("/api/clan/raid/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
        });
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        if (!r.ok) return { ok: false, error: (data.error as string) ?? `HTTP ${r.status}` };
        return { ok: true, ...data };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
