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

export const villages = ["Stormveil Village", "Ashen Leaf Village", "Frostfang Village", "Moonshadow Village"];

// 60 standard sectors plus sector 99 (the special lava arena slot).
export const worldSectorOptions = [...Array.from({ length: 60 }, (_, index) => index + 1), 99];

/** Default weather for a biome — first entry of its rotation table. */
export function weatherForBiome(biome: Biome) {
    return biomeWeatherTables[biome][0] ?? "clear";
}

/**
 * Map a sector number to its biome. Sector 99 is the special lava sector;
 * 1-20 are shadow, 21-35 forest, 36-45 volcano, 46-55 snow, 56-60 central.
 */
export function biomeForWorldSector(sector: number): Biome {
    if (sector === 99) return "volcano";
    if (sector >= 56) return "central";
    if (sector <= 20) return "shadow";
    if (sector <= 35) return "forest";
    if (sector <= 45) return "volcano";
    return "snow";
}

/**
 * Hard-coded sector number for each village's outskirts (where the
 * "leave village → walk into the world" gate connects to the world map).
 */
export function villageOutskirtsSectorNumber(villageName: string): number {
    if (villageName === "Stormveil Village") return 31;
    if (villageName === "Ashen Leaf Village") return 38;
    if (villageName === "Frostfang Village") return 47;
    if (villageName === "Moonshadow Village") return 11;
    return 40;
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
    switch (biomeForWorldSector(sector)) {
        case "shadow": return "the Shadowed Wilds";
        case "forest": return "the Deepwood";
        case "volcano": return "the Ashen Wastes";
        case "snow": return "the Frostreach";
        case "central": return "the Central Provinces";
        default: return "the far reaches";
    }
}
