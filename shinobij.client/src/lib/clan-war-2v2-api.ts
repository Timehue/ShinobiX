/*
 * Clan War shinobi 2v2 — client transport.
 *
 * The fight runs on the shared Tower MPvP surfaces (tower-pvp-api.ts): the same
 * state poll, the same idempotent action submit, the same viewer projection.
 * Only the two clan-war-owned ends live here — publishing the match for an
 * accepted challenge, and settling it into the war.
 */
import type { TowerPvpMatch } from "./tower-pvp-api";

export type ClanWar2v2Stash = {
    warId?: string;
    challengeId?: string;
    mode?: string;
};

/** The breadcrumb App.tsx already writes for every clan-war challenge launch. */
export function readClanWar2v2Stash(): ClanWar2v2Stash {
    try {
        return JSON.parse(sessionStorage.getItem("clanWarChallenge.v1") ?? "{}") as ClanWar2v2Stash;
    } catch {
        return {};
    }
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch("/api/clan/war/pvp-2v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(data.error ?? "Clan War 2v2 request failed."));
    return data;
}

/**
 * Publish or re-resolve the four-player match. Idempotent for all four members,
 * so every client can call it on entry and on reconnect.
 */
export async function startClanWar2v2(
    playerName: string,
    warId: string,
    challengeId: string,
): Promise<TowerPvpMatch> {
    const data = await post({ action: "start", playerName, warId, challengeId });
    const match = data.match as TowerPvpMatch | undefined;
    if (!match) throw new Error("The Clan War duel did not return a match.");
    return match;
}

/**
 * Settle the finished duel into the war. Exactly-once on the server via a
 * durable receipt, so all four members may call it and retries are free.
 *
 * Shaped as BattleTowerFight's `settleFn` (runId, playerName) — the runId IS the
 * match id — so the fight screen needs no clan-war-specific branch.
 */
export function settleClanWar2v2(challengeId: string) {
    return async (_matchId: string, playerName: string): Promise<unknown> =>
        post({ action: "settle", playerName, challengeId });
}
