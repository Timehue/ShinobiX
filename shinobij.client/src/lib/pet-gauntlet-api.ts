/*
 * Client side of the server-authoritative Pet Gauntlet rewards + weekly board.
 *
 * `start` fetches a SERVER-MINTED per-run seed plus a sealed single-use run token; the UI
 * seeds startGauntletRun with that seed so the server can replay the exact run.
 * `report` sends the player's decision TRANSCRIPT (drafts / rerolls / items /
 * relics / premium buys / per-fight placement) — the server RE-SIMULATES the run
 * and pays Ryo/premium from the SERVER-computed roundsCleared/heartsLeft, returning
 * the credited amounts + weekly rank, which we mirror onto the local character
 * (same reconcile pattern as claim-mission). The client never sends or trusts a
 * reward amount, roundsCleared, or heartsLeft. Both calls go through the
 * auth-wrapped global fetch (installAuthFetch), so no name/token plumbing here.
 */
import type { Character } from "../types/character";
import type { GauntletRun } from './pet-gauntlet';

// One player decision in a run, in the order performed. Fight outcomes are NOT
// recorded — the server re-fights each round. Mirrors GauntletAction in
// api/_pet-sim/gauntlet-sim.ts.
export type GauntletAction =
    | { k: "buy"; i: number }
    | { k: "item"; id: string }
    | { k: "relic"; id: string }
    | { k: "premium"; kind: "fateShard" | "boneCharm" }
    | { k: "reroll" }
    | { k: "release"; id: string }
    | { k: "fight"; place: { row: number; col: number }[] };

export interface GauntletStart {
    runToken: string;
    seed: number;
    weekKey: string;
    rewardEligible: boolean;
    maxRounds: number;
    /** The sealed ryo schedule for this run (scaled by level; shared/pet-gauntlet-economy.ts). */
    perRound?: number;
    clearBonus?: number;
    rewardedRunsLeft: number;
    chargedRyo: number;
    balances: { ryo: number };
    character: Character;
    _saveVersion?: number;
}

export interface GauntletReward {
    ryo: number;
    fateShards: number;
    boneCharms: number;
    balances: { ryo: number; fateShards: number; boneCharms: number };
    score: number | null;
    rank: number | null;
    weekKey: string;
    roundsCleared: number | null;
    heartsLeft: number | null;
    character?: Character;
    _saveVersion?: number;
}

export type PendingGauntlet = { player: string; run: GauntletRun; meta: { token: string; weekKey: string; rewardEligible: boolean }; transcript: GauntletAction[] };
const pendingKey = 'pet.gauntlet.pending.v1';
export function pendingGauntlet(player: string): PendingGauntlet | null {
    try {
        const value = JSON.parse(localStorage.getItem(pendingKey) || 'null') as PendingGauntlet | null;
        return value?.player === player && value.meta?.token && Array.isArray(value.transcript)
            && (value.run?.status === 'won' || value.run?.status === 'lost') ? value : null;
    } catch { return null; }
}
export function rememberGauntlet(value: PendingGauntlet | null) {
    try { if (value) localStorage.setItem(pendingKey, JSON.stringify(value)); else localStorage.removeItem(pendingKey); } catch { /* unavailable storage */ }
}

const entryKey = 'pet.gauntlet.entry.v1';
const entryRequests = new Map<string, { requestId: string; savedAt: number }>();
export async function startGauntlet(player = ''): Promise<GauntletStart | null> {
    let entry = entryRequests.get(player);
    try {
        const saved = JSON.parse(localStorage.getItem(entryKey) || 'null');
        if (saved?.player === player && typeof saved.requestId === 'string' && Number.isFinite(saved.savedAt)) entry = saved;
    } catch { /* unavailable storage */ }
    if (!entry || Date.now() - entry.savedAt >= 3_600_000) entry = { requestId: crypto.randomUUID(), savedAt: Date.now() };
    entryRequests.set(player, entry);
    const requestId = entry.requestId;
    try { localStorage.setItem(entryKey, JSON.stringify({ ...entry, player })); } catch { /* retain the in-memory retry */ }
    const confirmed = () => {
        if (entryRequests.get(player)?.requestId === requestId) entryRequests.delete(player);
        try { if (JSON.parse(localStorage.getItem(entryKey) || 'null')?.requestId === requestId) localStorage.removeItem(entryKey); } catch { /* unavailable storage */ }
    };
    try {
        const r = await fetch("/api/pet/gauntlet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start", requestId }),
        });
        const data = await r.json().catch(() => null) as (GauntletStart & { error?: string }) | null;
        if (!r.ok) {
            if (r.status === 409 && data?.error === 'This Gauntlet entry has already finished. Its reward is saved.') confirmed();
            return null;
        }
        if (typeof data?.runToken !== 'string' || !Number.isSafeInteger(data.seed)) return null;
        confirmed();
        return data;
    } catch {
        return null;
    }
}

export async function reportGauntlet(runToken: string, transcript: GauntletAction[]): Promise<GauntletReward | { expired: true } | null> {
    try {
        const r = await fetch("/api/pet/gauntlet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "report", runToken, transcript }),
        });
        const data = await r.json().catch(() => null) as (GauntletReward & { code?: string }) | null;
        if (r.status === 409 && data?.code === 'GAUNTLET_REPORT_EXPIRED') return { expired: true };
        if (!r.ok) return null;
        return Number.isFinite(data?.ryo) && Number.isFinite(data?.fateShards) && Number.isFinite(data?.boneCharms)
            && typeof data?.character?.name === 'string' && Number.isSafeInteger(data._saveVersion)
            && (data.score === null || Number.isFinite(data.score)) && (data.rank === null || Number.isFinite(data.rank)) ? data : null;
    } catch {
        return null;
    }
}

export interface GauntletLbRow { rank: number; name: string; village?: string; score: number; roundsCleared: number; heartsLeft: number; }

export async function fetchGauntletLeaderboard(top = 25): Promise<{ weekKey: string; leaderboard: GauntletLbRow[] }> {
    try {
        const r = await fetch(`/api/pet/gauntlet?top=${top}`);
        if (!r.ok) return { weekKey: "", leaderboard: [] };
        const data = await r.json();
        return { weekKey: String(data.weekKey ?? ""), leaderboard: (data.leaderboard ?? []) as GauntletLbRow[] };
    } catch {
        return { weekKey: "", leaderboard: [] };
    }
}
