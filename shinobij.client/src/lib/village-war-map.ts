// Client data layer for the Village War Map (Phase 6). Types mirroring the
// server's /api/village/war-map aggregator + the sector-war action endpoints,
// and thin authed fetch wrappers. (authFetch patches window.fetch globally, so a
// plain fetch already carries the player token / name / fingerprint headers.)

import type { IntelTier, StoresLedgerEntry } from "./village-stores";

export type WinCondition = "combat" | "card" | "pet";

export interface SectorConfigView {
    sector: number;
    alias?: string;
    winCondition: WinCondition;
    terrain: string;
}

export interface VillageWarMapView {
    village: string;
    biome: string;
    homeSectors: number[];
    warResources: number;
    warResourcesCap: number;
    treasurySeals: number;
    structures: Record<string, number>;
    upkeepWr: number;
    dormant: boolean;
    wrPerSector: number;
    sectorsHeld: number;
    taxRatePct: number;
    /** No seated Kage → the rate is forced to 0 (mirrors api/_war-tax-apply.ts). */
    kageSeated?: boolean;
    sectors: SectorConfigView[];
    // ── Village Stores (api/_village-stores.ts; optional while the switch is off) ──
    /** Rations in the treasury. */
    provisions?: number;
    /** Craft points in the treasury. */
    materialPoints?: number;
    /** Max WR the Supply Depot converts from materials per day. */
    depotConversionCap?: number;
    /** Last 10 stores ledger rows, oldest first. */
    storesLedger?: StoresLedgerEntry[];
}

export interface SectorWarContest {
    id: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    winCondition: WinCondition;
    /** Kill-point tallies — they count UP; most points when the 72h close wins. */
    attackerPoints: number;
    defenderPoints: number;
    /** When the war's 72 hours end and the tallies are compared. */
    endsAt: number;
    flipped: boolean;
    /** When a LIVE-player battle last resolved. Drives the garrison fallback
     *  (garrisonAssaultable below) — mirrors api/_sector-war.ts lastLiveBattleAt. */
    lastLiveBattleAt?: number;
    startedAt?: number;
    // ── Village Stores (written by the daily pass / garrison-feed) ──
    /** False when a participant's provisions could not cover the war today (undefined = fed). */
    fed?: boolean;
    /** Villages that went unfed for this war today. */
    unfedVillages?: string[];
    /** UTC day (YYYY-MM-DD) the stores pass last evaluated this war. The `fed`
     *  verdict above only applies to THAT day — see contestVillageUnfed. */
    storesDate?: string;
    /** Garrison feed PER VILLAGE (api/_sector-war.ts garrisonFeed) — each side
     *  only ever sets/clears its own entry. Read through contestGarrisonFeed(). */
    garrisonFeed?: Record<string, { on: boolean; covered: boolean; updatedAt?: number; by?: string }>;
    /** Compatibility mirror of the VIEWER's own entry, derived server-side. */
    garrisonFed?: boolean;
    garrisonFedBy?: string;
    garrisonCovered?: boolean;
}

/** `village`'s own garrison-feed state on this contest (never the other side's). */
export function contestGarrisonFeed(c: Pick<SectorWarContest, "garrisonFeed" | "garrisonFed" | "garrisonFedBy" | "garrisonCovered">, village: string): { on: boolean; covered: boolean } {
    const e = c.garrisonFeed?.[village];
    if (e) return { on: e.on === true, covered: e.covered === true };
    if (c.garrisonFed === true && c.garrisonFedBy === village) return { on: true, covered: c.garrisonCovered === true };
    return { on: false, covered: false };
}

/** The UTC day a stores verdict must carry to still apply. */
export function storesUtcDay(now: number = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** Whether `village` marches hungry on this contest today.
 *
 *  MUST match api/_sector-war.ts sectorWarVillageUnfed: the `fed: false` verdict
 *  expires with its `storesDate`, so a day the daily pass never ran (a throw, or
 *  the Village Stores kill switch) reads as FED instead of freezing yesterday's
 *  verdict — otherwise the "marches hungry" plate would be permanently stuck on
 *  a village that has since restocked. */
export function contestVillageUnfed(
    c: Pick<SectorWarContest, "fed" | "unfedVillages" | "storesDate">,
    village: string,
    today: string = storesUtcDay(),
): boolean {
    if (!today || c.storesDate !== today) return false;
    if (c.fed !== false) return false;
    const list = c.unfedVillages ?? [];
    return list.length === 0 || list.includes(village);
}

/** Thrown by the action wrappers. `message` is the PLAYER-FACING sentence: the
 *  endpoints send a humanised `message` beside the machine `error` code (see
 *  api/village/war-structure.ts structureUpgradeErrorMessage), and it wins — a
 *  screen that prints `e.message` must never show "insufficient-seals". `data`
 *  is the full JSON body (e.g. a 402 `materials-required` carries need/have). */
export class WarMapRequestError extends Error {
    readonly status: number;
    readonly data: Record<string, unknown>;
    constructor(status: number, data: Record<string, unknown>) {
        super(String(data.message ?? data.error ?? `HTTP ${status}`));
        this.name = "WarMapRequestError";
        this.status = status;
        this.data = data;
    }
}

/** ~2h with no live-player battle unlocks the sector's ANBU garrison. MUST match
 *  api/_sector-war.ts GARRISON_UNLOCK_IDLE_MS. */
export const GARRISON_UNLOCK_IDLE_MS = 2 * 60 * 60 * 1000;

/** Mirror of api/_sector-war.ts isGarrisonAssaultable for the button's enabled
 *  state. The server re-checks it — this only avoids offering a rejected click. */
export function garrisonAssaultable(c: SectorWarContest, now: number = Date.now()): boolean {
    if (c.winCondition !== "combat" || c.flipped) return false;
    if (now >= (Number(c.endsAt) || 0)) return false; // the whistle has gone
    const lastLive = Math.max(Number(c.lastLiveBattleAt ?? 0) || 0, Number(c.startedAt ?? 0) || 0);
    return lastLive > 0 && now - lastLive >= GARRISON_UNLOCK_IDLE_MS;
}

export interface WarMapResponse {
    ok: boolean;
    enabled: boolean;
    villages: VillageWarMapView[];
    contests: SectorWarContest[];
}

// The 6 shared structures (mirror of api/_war-state.ts STRUCTURE_KEYS), with
// display names for the upgrade panel.
export const WAR_STRUCTURES: readonly { key: string; name: string }[] = [
    { key: "ramparts", name: "Ramparts" },
    { key: "watchtower", name: "Watchtower" },
    { key: "barracks", name: "Barracks" },
    { key: "warAcademy", name: "War Academy" },
    { key: "supplyDepot", name: "Supply Depot" },
    { key: "treasuryVault", name: "Treasury Vault" },
];

// The 5 terrain options (mirror of api/_war-state.ts TERRAINS).
export const WAR_TERRAINS: readonly string[] = [
    "forest", "snow", "volcano", "shadow", "central",
];

// Per-village accent colour — the CANONICAL per-village landmark colours from
// atlas-skin.css (.atlas-landmark[title*=...]), so the War Map matches the rest
// of the app (§10.2).
export const VILLAGE_ACCENT: Record<string, string> = {
    "Moonshadow Village": "#a78bfa", // purple
    "Stormveil Village": "#3b82f6",  // blue
    "Ashen Leaf Village": "#4ade80", // green
    "Frostfang Village": "#93c5fd",  // light blue
};
export function villageAccent(village: string): string {
    return VILLAGE_ACCENT[village] ?? "#94a3b8";
}

// Master client flag for the War-Map UI. ALWAYS ON — the Village War Map has
// launched and it is a gameplay layer, so it is not a per-device choice (the old
// localStorage `villageWarMap.v1 = "0"` opt-out let one browser hide a war the
// rest of the village was fighting). The function is kept so call sites compile
// unchanged; it is a constant, never a storage read. The SERVER keeps its own
// independent gate: ENABLE_VILLAGE_WAR defaults on, kill-switch DISABLE_VILLAGE_WAR=1.
export function isVillageWarMapEnabled(): boolean {
    return true;
}

// ── Fetch wrappers ──────────────────────────────────────────────────────────

async function postJson(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    // Every action in this module can move the war map, and the screens follow
    // one with an immediate refresh(). Drop the read memo here so that refresh
    // really re-reads — the memo is only ever allowed to elide a REPEAT read.
    clearWarMapCache();
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new WarMapRequestError(r.status, data);
    return data;
}

/*
 * /api/village/war-map is an AGGREGATOR, not a cheap read: it does eight KV
 * reads plus loadHeldSectorCounts(), which is a `world:territory:*` wildcard
 * scan and mget, and it answers `private, no-store` so no cache layer elides a
 * repeat. The Town Hall now calls it on tab entry from BOTH the default
 * Command tab and Treasury, so a player flicking tabs used to fire that scan
 * once per flick. This module-level memo collapses that the way lib/village-
 * intel.ts already does: one in-flight promise shared by every concurrent
 * caller, and a short TTL so a re-entry inside the window reuses the answer.
 *
 * Deliberately SHORT (the map moves on war actions), and deliberately not a
 * cache of failures — a rejection clears both, so a retry really retries.
 */
export const WAR_MAP_MEMO_MS = 8_000;
let warMapInFlight: Promise<WarMapResponse> | null = null;
let warMapAt = 0;
let warMapValue: WarMapResponse | null = null;

/** Drop the memo (logout / account switch / a war action that just moved it). */
export function clearWarMapCache(): void {
    warMapInFlight = null;
    warMapAt = 0;
    warMapValue = null;
}

export function fetchWarMap(): Promise<WarMapResponse> {
    if (warMapInFlight) return warMapInFlight;
    if (warMapValue && Date.now() - warMapAt < WAR_MAP_MEMO_MS) return Promise.resolve(warMapValue);
    const pending = (async () => {
        const r = await fetch("/api/village/war-map", { method: "GET" });
        const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) throw new Error(String(data.error ?? `HTTP ${r.status}`));
        return data as unknown as WarMapResponse;
    })();
    warMapInFlight = pending;
    return pending.then(
        (value) => {
            if (warMapInFlight === pending) {
                warMapInFlight = null;
                warMapValue = value;
                warMapAt = Date.now();
            }
            return value;
        },
        (err) => {
            // Never memoize a failure: the next caller must reach the server.
            if (warMapInFlight === pending) clearWarMapCache();
            throw err;
        },
    );
}

export interface DeclareSectorWarResponse {
    ok?: boolean;
    cost?: number;
    alreadyOpen?: boolean;
    /** Village Stores — Intel: the tier that discounted this declare and the
     *  base it reduced 250 WR to (the comeback multiplier applies on top). */
    intelTier?: IntelTier;
    intelBaseCost?: number;
    contest?: SectorWarContest;
}
export function declareSectorWar(playerName: string, village: string, sector: number): Promise<DeclareSectorWarResponse> {
    return postJson("/api/village/sector-war", { action: "declare", playerName, village, sector }) as Promise<DeclareSectorWarResponse>;
}
/** Village Stores — toggle the garrison-feed (15 rations/day) on an active
 *  contest. Kage or ANBU appointee of either participant; the server re-checks. */
export function setGarrisonFeed(playerName: string, sectorWarId: string, on: boolean): Promise<{ ok?: boolean; village?: string; garrisonFed?: boolean; contest?: SectorWarContest }> {
    return postJson("/api/village/sector-war", { action: "garrison-feed", playerName, sectorWarId, on }) as Promise<{ ok?: boolean; village?: string; garrisonFed?: boolean; contest?: SectorWarContest }>;
}
/** Call off a siege your village is running. Attacking Kage only; the WR spent
 *  declaring is not refunded. An untouched siege also lapses on its own after 24h. */
export function abandonSectorWar(playerName: string, sector: number) {
    return postJson("/api/village/sector-war", { action: "abandon", playerName, sector });
}
export function sectorWarStatus(playerName: string, sector?: number) {
    return postJson("/api/village/sector-war", { action: "status", playerName, sector });
}
export function registerSectorBattle(playerName: string, sector: number, battleId: string, signal?: AbortSignal) {
    return postJson("/api/village/sector-war", { action: "attack", playerName, sector, battleId }, signal);
}
export async function confirmSectorBattleRegistration(
    playerName: string,
    sector: number,
    battleId: string,
    scope: { signal: AbortSignal; isCurrent: () => boolean },
): Promise<Record<string, unknown>> {
    let lastError: unknown = new Error("Sector registration was not attempted.");
    for (let attempt = 0; attempt < 4; attempt += 1) {
        if (scope.signal.aborted || !scope.isCurrent()) throw new DOMException("PvP create scope changed.", "AbortError");
        if (attempt > 0) {
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
                const timer = setTimeout(() => {
                    scope.signal.removeEventListener("abort", onAbort);
                    resolve();
                }, 250 * attempt);
                scope.signal.addEventListener("abort", onAbort, { once: true });
            });
        }
        try {
            const result = await registerSectorBattle(playerName, sector, battleId, scope.signal);
            if (!scope.isCurrent()) throw new DOMException("PvP create scope changed.", "AbortError");
            return result;
        } catch (error) {
            if (scope.signal.aborted || !scope.isCurrent()) throw error;
            lastError = error;
        }
    }
    throw lastError;
}
export function resolveSectorBattle(playerName: string, battleId: string) {
    return postJson("/api/village/sector-war", { action: "resolve", playerName, battleId });
}
// Sector War "Pet" win-condition — a server-resolved deterministic pet duel.
export function joinSectorPet(playerName: string, sectorWarId: string, petId: string) {
    return postJson("/api/village/sector-pet", { action: "join", playerName, sectorWarId, petId });
}
export function sectorPetState(playerName: string, sectorWarId: string) {
    return postJson("/api/village/sector-pet", { action: "state", playerName, sectorWarId });
}
export function sectorPetWatch(playerName: string, sectorWarId: string) {
    return postJson("/api/village/sector-pet", { action: "watch", playerName, sectorWarId });
}
export function setSectorWinCondition(playerName: string, village: string, sector: number, winCondition: WinCondition) {
    return postJson("/api/village/war-win-condition", { playerName, village, sector, winCondition });
}
export function setSectorTerrain(playerName: string, village: string, sector: number, terrain: string) {
    return postJson("/api/village/war-terrain", { playerName, village, sector, terrain });
}
export function upgradeWarStructure(playerName: string, village: string, structure: string) {
    return postJson("/api/village/war-structure", { playerName, village, structure });
}

// ── Mercenaries (Phase 5) ──
export interface WrMercTierView { id: string; level: number; costWr: number; }
export interface MercLeaseView { tierId: string; player: string; expiresAt: number; count: number; }

/** Hire a merc tier — the seated Kage spends village WR to field a 2-day band of
 *  3-5 AI mercs. Returns { cost, band, expiresAt }. */
export function hireMerc(playerName: string, village: string, tierId: string) {
    return postJson("/api/village/war-merc", { action: "hire", playerName, village, tierId });
}
/** Read this village's WR pool + the merc tier menu + the active bands. */
export function listMercs(playerName: string, village: string) {
    return postJson("/api/village/war-merc", { action: "list", playerName, village });
}
/** Deploy one merc from the band at an enemy-village defender on a contested
 *  sector. The fight resolves SERVER-SIDE (auto, deterministic, can't be faked);
 *  returns { winner, attackerPoints, defenderPoints, mercsRemaining }. */
export function deployMerc(playerName: string, village: string, tierId: string, sector: number, targetPlayer: string) {
    return postJson("/api/village/war-merc", { action: "attack", playerName, village, tierId, sector, targetPlayer });
}
