/*
 * World-map sector + village geography.
 *
 * Pure data + four pure mappers. No closures, no app state — the entire
 * worldmap "where is what" lookup table.
 *
 *   • villages                       — canonical four-village list
 *   • worldSectorOptions             — admin dropdown options for sector picker
 *                                      (1..60 plus the special "99" lava sector)
 *   • weatherForBiome(biome)         — default-weather lookup
 *   • biomeForWorldSector(sector)    — sector number → biome
 *   • villageOutskirtsSectorNumber() — village name → sector right outside it
 *   • villageForOutskirtsSector()    — inverse lookup
 *
 * weatherForSector (which reads dynamic territory data) stays in App.tsx
 * because it closes over loadSectorTerritory.
 *
 * Extracted from App.tsx.
 */

import type { Biome } from "../types/core";
import { biomeWeatherTables } from "./world";
import { sectorBiomeOf, sectorRegionLabel, VILLAGE_OUTSKIRTS } from "../../../shared/sector-geo";

export const villages = ["Stormveil Village", "Ashen Leaf Village", "Frostfang Village", "Moonshadow Village"];

// 60 standard sectors plus sector 99 (the special lava arena slot).
export const worldSectorOptions = [...Array.from({ length: 60 }, (_, index) => index + 1), 99];

/** Default weather for a biome — first entry of its rotation table. */
export function weatherForBiome(biome: Biome) {
    return biomeWeatherTables[biome][0] ?? "clear";
}

/**
 * Map a sector number to its biome — table-driven from the shared geography
 * registry (shared/sector-geo.ts), which follows the PAINTED map rather than
 * the old numeric bands. Sector 99 is the special lava sector.
 */
export function biomeForWorldSector(sector: number): Biome {
    return sectorBiomeOf(sector) as Biome;
}

/**
 * Sector number for each village's outskirts (where the "leave village → walk
 * into the world" gate connects to the world map). Under the 2026-07
 * region-block numbering each village's block STARTS at its own gate.
 */
export function villageOutskirtsSectorNumber(villageName: string): number {
    return VILLAGE_OUTSKIRTS[villageName] ?? 13;
}

/** Inverse of villageOutskirtsSectorNumber — returns undefined if no match. */
export function villageForOutskirtsSector(sector: number): string | undefined {
    return villages.find((village) => villageOutskirtsSectorNumber(village) === sector);
}

/**
 * A poetic region name for a world sector — for atmospheric copy (Legacy
 * whispers, emissary sightings) that would otherwise read a raw "sector 47".
 * The on-map marker still shows the exact spot; this is flavor for the prose.
 */
export function sectorRegionName(sector: number): string {
    if (sector === 99) return "the Lavafront";
    const village = villageForOutskirtsSector(sector);
    if (village) return `the outskirts of ${village.replace(/ Village$/, "")}`;
    return sectorRegionLabel(sector) ?? "the far reaches";
}
