// Client data layer for the Village War Map (Phase 6). Types mirroring the
// server's /api/village/war-map aggregator + the sector-war action endpoints,
// and thin authed fetch wrappers. (authFetch patches window.fetch globally, so a
// plain fetch already carries the player token / name / fingerprint headers.)

export type WinCondition = "combat" | "card" | "pet";

export interface SectorConfigView {
    sector: number;
    alias?: string;
    winCondition: WinCondition;
    terrain: string;
    controlHpMax: number;
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
    sectors: SectorConfigView[];
}

export interface SectorWarContest {
    id: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    winCondition: WinCondition;
    controlHp: number;
    controlHpMax: number;
    flipped: boolean;
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

// Per-village accent colour — pairs with the accents in atlas-skin.css (§10.2).
export const VILLAGE_ACCENT: Record<string, string> = {
    "Moonshadow Village": "#a78bfa", // purple
    "Stormveil Village": "#4ade80",  // green
    "Ashen Leaf Village": "#fb923c", // orange
    "Frostfang Village": "#60a5fa",  // blue
};
export function villageAccent(village: string): string {
    return VILLAGE_ACCENT[village] ?? "#94a3b8";
}

// Master client flag for the War-Map UI (default OFF, §12 villageWarMap.v1). The
// server endpoints are independently gated by ENABLE_VILLAGE_WAR.
export function isVillageWarMapEnabled(): boolean {
    try {
        return localStorage.getItem("villageWarMap.v1") === "1";
    } catch {
        return false;
    }
}

// ── Fetch wrappers ──────────────────────────────────────────────────────────

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(data.error ?? `HTTP ${r.status}`));
    return data;
}

export async function fetchWarMap(): Promise<WarMapResponse> {
    const r = await fetch("/api/village/war-map", { method: "GET" });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(data.error ?? `HTTP ${r.status}`));
    return data as unknown as WarMapResponse;
}

export function declareSectorWar(playerName: string, village: string, sector: number) {
    return postJson("/api/village/sector-war", { action: "declare", playerName, village, sector });
}
export function sectorWarStatus(playerName: string, sector?: number) {
    return postJson("/api/village/sector-war", { action: "status", playerName, sector });
}
export function registerSectorBattle(playerName: string, sector: number, battleId: string) {
    return postJson("/api/village/sector-war", { action: "attack", playerName, sector, battleId });
}
export function resolveSectorBattle(playerName: string, battleId: string) {
    return postJson("/api/village/sector-war", { action: "resolve", playerName, battleId });
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
