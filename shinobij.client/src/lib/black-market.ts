/*
 * Client wrapper for the Sunscar black-market gamble
 * (api/festival/black-market.ts). The server is fully authoritative: it debits
 * the cost, rolls the payout, and returns the updated character. KEEP cost/cap in sync with
 * api/festival/_black-market.ts.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Character } from "../types/character";
import { serverNow } from "./server-clock";

// MIRROR: api/festival/_black-market.ts BLACK_MARKET_COST — the server debits,
// this is the displayed price. Keep in sync or the pull quotes one number and
// charges another.
export const BLACK_MARKET_COST = 75_000;
export const BLACK_MARKET_DAILY_CAP = 10;

export type BlackMarketReward = {
    tier: 'scraps' | 'trinket' | 'haul' | 'relic' | 'fortune' | 'jackpot';
    label: string;
    ryo: number;
    fateShards: number;
    boneCharms: number;
    auraStones: number;
    mythicSeals: number;
};

export type BlackMarketResult = {
    ok: boolean;
    error?: string;
    cost?: number;
    reward?: BlackMarketReward;
    dailyUsed?: number;
    dailyCap?: number;
    balanceRyo?: number;
    character?: Character;
    _saveVersion?: unknown;
};

export async function pullBlackMarket(playerName: string): Promise<BlackMarketResult> {
    try {
        const res = await fetch('/api/festival/black-market', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName }),
        });
        const data = await res.json().catch(() => ({})) as BlackMarketResult;
        // A refusal at the cap reports the count too, so record it either way.
        if (typeof data.dailyUsed === 'number') recordBlackMarketUsage(playerName, utcDay(serverNow()), data.dailyUsed);
        if (!res.ok || !data.ok) return { ok: false, error: data.error || 'The black market turns you away.', dailyUsed: data.dailyUsed, dailyCap: data.dailyCap };
        return data;
    } catch {
        return { ok: false, error: 'Pull unconfirmed. Refresh before retrying.' };
    }
}

/*
 * Today's crate count, shared by the player card's daily-caps grid (desktop rail
 * and mobile sheet) and the festival hub.
 *
 * The server keeps this count in its own per-day key, not on the character, so
 * the save never carries it. A page fetches each player's count once per UTC day
 * (a reload fetches again) and then keeps it current from every pull's reply.
 * Within a day the count only rises, so a slow fetch can never undo a pull the
 * player just made. A pull made on another device shows up after a reload.
 *
 * A tiny external store rather than props, for the same reason as own-avatar.ts:
 * the card has two hosts plus the festival, and threading it through App.tsx
 * would grow a file under a line-budget ratchet.
 */
// Keyed `<player>|<day>`. Replaced, never mutated, so useSyncExternalStore sees
// a new snapshot on every change.
let crateUsage: ReadonlyMap<string, number> = new Map();
const crateUsageSubscribers = new Set<() => void>();
const crateUsageRequested = new Set<string>();

function usageKey(playerName: string, day: string): string {
    return `${playerName.trim().toLowerCase()}|${day}`;
}

/** The UTC calendar day the server's per-day crate counter is keyed by. */
export function utcDay(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

export function recordBlackMarketUsage(playerName: string, day: string, used: number): void {
    if (!playerName.trim() || !Number.isFinite(used)) return;
    const key = usageKey(playerName, day);
    if (used <= (crateUsage.get(key) ?? -1)) return;
    crateUsage = new Map(crateUsage).set(key, used);
    for (const notify of crateUsageSubscribers) notify();
}

export async function getBlackMarketUsage(playerName: string): Promise<{ dailyUsed: number; dailyCap: number; day: string } | null> {
    try {
        const res = await fetch(`/api/festival/black-market?${new URLSearchParams({ playerName }).toString()}`);
        const data = await res.json().catch(() => ({})) as { dailyUsed?: unknown; dailyCap?: unknown; day?: unknown };
        if (!res.ok || typeof data.dailyUsed !== 'number' || !Number.isFinite(data.dailyUsed) || typeof data.day !== 'string') return null;
        return { dailyUsed: data.dailyUsed, dailyCap: typeof data.dailyCap === 'number' ? data.dailyCap : BLACK_MARKET_DAILY_CAP, day: data.day };
    } catch {
        return null;
    }
}

// One fetch per player per day, however many surfaces mount. A failed fetch
// clears its mark so the next surface to mount can try again.
export function requestBlackMarketUsage(playerName: string, day: string): void {
    const key = usageKey(playerName, day);
    if (!playerName.trim() || crateUsageRequested.has(key)) return;
    crateUsageRequested.add(key);
    void getBlackMarketUsage(playerName).then((usage) => {
        if (usage) recordBlackMarketUsage(playerName, usage.day, usage.dailyUsed);
        else crateUsageRequested.delete(key);
    });
}

function subscribeCrateUsage(notify: () => void): () => void {
    crateUsageSubscribers.add(notify);
    return () => { crateUsageSubscribers.delete(notify); };
}

function getCrateUsage(): ReadonlyMap<string, number> {
    return crateUsage;
}

/** Test seam / non-React readers: the known count, or null. */
export function knownBlackMarketUsage(playerName: string, day: string): number | null {
    return crateUsage.get(usageKey(playerName, day)) ?? null;
}

/** Crates this player has bought on `day`, or null until the count is known. */
export function useBlackMarketUsage(playerName: string, day: string): number | null {
    const usage = useSyncExternalStore(subscribeCrateUsage, getCrateUsage, getCrateUsage);
    useEffect(() => { requestBlackMarketUsage(playerName, day); }, [playerName, day]);
    return usage.get(usageKey(playerName, day)) ?? null;
}

/** Test seam: forget every recorded count and fetch mark. */
export function resetBlackMarketUsageForTests(): void {
    crateUsage = new Map();
    crateUsageRequested.clear();
}

// Human-readable summary of what a pull awarded (for the festival log).
export function describeReward(reward: BlackMarketReward): string {
    const parts = [
        reward.ryo > 0 && `+${reward.ryo.toLocaleString()} ryo`,
        reward.fateShards > 0 && `+${reward.fateShards} Fate Shards`,
        reward.boneCharms > 0 && `+${reward.boneCharms} Bone Charms`,
        reward.auraStones > 0 && `+${reward.auraStones} Aura Stones`,
        reward.mythicSeals > 0 && `+${reward.mythicSeals} Mythic Seal${reward.mythicSeals === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : 'nothing but sand';
}
