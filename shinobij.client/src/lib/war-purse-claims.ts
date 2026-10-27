/*
 * War purses on the client (2026-10 rebalance, framework #7).
 *
 * The village-war purse rides the ordinary village claim
 * (/api/war/claim-reward kind 'village'): its reply carries `purse`. The
 * sector-war purse names no war, so it is claimed on its own (kind 'sector'):
 * the server pays every unclaimed sector-war purse the player earned in the last
 * 7 days, once. The reward hook re-runs on every world-state version and the
 * route is rate-limited, so the sector claim is throttled to once per
 * SECTOR_PURSE_CLAIM_INTERVAL_MS per player per session.
 */

import type { Character } from "../types/character";

export const SECTOR_PURSE_CLAIM_INTERVAL_MS = 10 * 60 * 1000;

const lastSectorClaimAt = new Map<string, number>();

/** Whether this session may ask for the player's sector purses now; marks the ask. */
export function takeSectorPurseClaimSlot(playerName: string, now: number = Date.now()): boolean {
    const key = playerName.trim().toLowerCase();
    if (!key) return false;
    const last = lastSectorClaimAt.get(key);
    if (last !== undefined && now - last < SECTOR_PURSE_CLAIM_INTERVAL_MS) return false;
    lastSectorClaimAt.set(key, now);
    return true;
}

/** For tests. */
export function resetSectorPurseClaimSlots(): void {
    lastSectorClaimAt.clear();
}

export type SectorPurseClaim = { character: Character; _saveVersion: unknown; ryo: number };

/** Claim the player's sector-war purses (throttled). Null when nothing was paid. */
export async function claimSectorWarPurses(character: Pick<Character, "name">, now: number = Date.now()): Promise<SectorPurseClaim | null> {
    if (!takeSectorPurseClaimSlot(character.name, now)) return null;
    try {
        const response = await fetch("/api/war/claim-reward", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName: character.name, kind: "sector" }),
        });
        if (!response.ok) return null;
        const body = await response.json() as { granted?: boolean; character?: Character; _saveVersion?: unknown; sectorPurseRyo?: unknown };
        if (body.granted !== true || !body.character) return null;
        return { character: body.character, _saveVersion: body._saveVersion, ryo: Math.max(0, Number(body.sectorPurseRyo) || 0) };
    } catch {
        // Fail closed; the next slot asks again, and the server pays once.
        return null;
    }
}

/** The alert after the ended-war claims, or null when they paid nothing worth one. */
export function warRewardAlert(reward: { crates: number; mvp: boolean; consolation: boolean; purse?: number }): string | null {
    const purse = Math.max(0, Number(reward.purse) || 0);
    const purseLine = purse > 0 ? `War purse delivered: +${purse.toLocaleString()} ryo.` : "";
    const lead = reward.crates > 0
        ? `You received ${reward.crates} Legendary War Crate${reward.crates > 1 ? "s" : ""} from recent war rewards! Check your inventory.`
        : reward.mvp ? "MVP rewards delivered: bonus ryo, honor seals, and fate shards added to your account."
            : reward.consolation ? "Your recent war-loss rewards have been settled." : "";
    return [lead, purseLine].filter(Boolean).join(" ") || null;
}

export function sectorPurseAlert(ryo: number): string {
    return `Sector war purse delivered: +${Math.max(0, Math.floor(ryo)).toLocaleString()} ryo.`;
}
