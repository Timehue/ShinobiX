/*
 * Client wrappers for the Weekly Clan Boss Gauntlet (api/clan-boss/*). An assault
 * reuses the Battle-Towers fight screen; only start + settle are clan-boss-specific
 * (the server computes damage and banks it into the clan pool). Auth headers are
 * attached by the global fetch interceptor. Player-facing admission is gated
 * by the public live-capability projection at each mixed-purpose surface.
 */
import type { TowerSession, TowerHostLoadout } from "./towers-api";
import type { ClanBossPartyEnvelope } from "../../../shared/clan-boss-operation";

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
    boss?: { id: string; name: string; icon: string; flavor: string; mechanic: string; sectorId: number } | null;
    sectorState?: { weekId: string; bossId: string; sectorId: number; sectorName: string; regionName: string; pressure: number; version: number; updatedAt: number };
    inClan?: boolean;
    myClan?: ClanBossMyClan | null;
    standings?: ClanBossStanding[];
    lastWeek?: { rank: number; score: number; killed: boolean } | null;
};

export async function fetchClanBoss(player: string): Promise<ClanBossView | null> {
    try {
        const r = await fetch(`/api/clan-boss/get?player=${encodeURIComponent(player)}`);
        if (!r.ok) return null;
        return (await r.json()) as ClanBossView;
    } catch { return null; }
}

export type ClanBossStartResult =
    | { runId: string; session: TowerSession; replayed?: boolean; boss?: { id: string; name: string; icon: string } }
    | { error: string; status?: number };

export async function startClanBossAssault(hostName: string, partyId: string | undefined, expectedVersion: number | undefined, requestId: string, hostLoadout?: TowerHostLoadout): Promise<ClanBossStartResult> {
    try {
        const r = await fetch("/api/clan-boss/assault-start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hostName, partyId, expectedVersion, requestId, hostLoadout }),
        });
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        if (!r.ok) return { error: (data.error as string) ?? `HTTP ${r.status}`, status: r.status };
        return data as ClanBossStartResult;
    } catch (e) { return { error: String((e as Error).message) }; }
}

export async function fetchClanBossParty(playerName: string): Promise<ClanBossPartyEnvelope | null> {
    try {
        const response = await fetch(`/api/clan-boss/party?player=${encodeURIComponent(playerName)}`);
        if (response.status === 404) return { ok: false, errorCode: "parties-disabled", serverNow: Date.now(), party: null, invitations: [], publicParties: [], population: { publicParties: 0, openSeats: 0 } };
        if (!response.ok) return null;
        return await response.json() as ClanBossPartyEnvelope;
    } catch { return null; }
}

export async function mutateClanBossParty(input: {
    playerName: string;
    action: string;
    partyId?: string;
    expectedVersion?: number;
    target?: string;
    visibility?: "public" | "private";
    ping?: string;
    requestId: string;
}): Promise<ClanBossPartyEnvelope> {
    try {
        const response = await fetch("/api/clan-boss/party", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const data = await response.json().catch(() => ({})) as ClanBossPartyEnvelope;
        if (!response.ok) return { ...data, ok: false, serverNow: Date.now(), party: data.party ?? null, invitations: data.invitations ?? [], publicParties: data.publicParties ?? [], population: data.population ?? { publicParties: 0, openSeats: 0 } };
        return data;
    } catch {
        return { ok: false, error: "The operation service is offline. Your party state was not changed.", errorCode: "offline", serverNow: Date.now(), party: null, invitations: [], publicParties: [], population: { publicParties: 0, openSeats: 0 } };
    }
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
