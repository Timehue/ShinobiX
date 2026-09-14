import {
    villageForOutskirtsSector,
    biomeForWorldSector,
} from "../../data/sectors";
import {
    villagePageImage,
} from "../../lib/village-page-image";
import iceSectorImg from "../../assets/sectors/ice.webp";
import darkSectorImg from "../../assets/sectors/dark.webp";
import templeSectorImg from "../../assets/sectors/temple.webp";
import waterSectorImg from "../../assets/sectors/water.webp";
import stormveilVillageImg from "../../assets/sectors/stormveil-village.webp";
import forrestSectorImg from "../../assets/sectors/forrest.webp";
import meadow2SectorImg from "../../assets/sectors/meadow2.webp";
import meadowSectorImg from "../../assets/sectors/meadow.webp";
import {
    SECTOR_DEPTH_THEMES,
} from "../../data/sector-depth-manifest";
import {
    type Biome,
} from "../../types/core";
import {
    sectorArtKey,
} from "../../../../shared/sector-geo";
import {
    SECTOR_FLOOR_SECTORS,
} from "../../data/sector-art-manifest";

// Which scene-image theme each sector shows. Single source of truth shared by
// the background image picker and the ambience-biome picker so the drifting
// particles always match the painted scene the player is looking at.
const SECTOR_IMAGE_GROUPS: Record<string, number[]> = {
    ice: [52, 48, 53, 54, 50, 55],
    dark: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 17, 20, 19, 18, 14, 15, 13],
    temple: [34, 60, 59],
    water: [23, 26, 21, 22, 27, 32, 28, 33, 42],
    forrest: [36, 37, 38, 39, 40, 43, 46],
    stormveil: [31, 35, 10, 16],
    meadow2: [44, 24, 29, 30, 59, 1],
    meadow: [25, 41, 45, 47, 57, 51],
};

function sectorImageTheme(sector: number): string {
    for (const [theme, sectors] of Object.entries(SECTOR_IMAGE_GROUPS)) {
        if (sectors.includes(sector)) return theme;
    }
    return "meadow";
}

/*
 * Backdrop for the <SectorScene> vista stack. Since the painted top-down floors
 * cover every sector, that stack now renders ONLY for a territory carrying its
 * own custom `backgroundImage` (creator/admin art), which is passed in directly —
 * so this resolver is just the shared theme fallback. The 66 bespoke per-sector
 * vistas it used to return were retired with the opt-out path (2026-07-29): they
 * were unreachable by default and 7.3 MB of deploy weight.
 */
function sectorBackgroundImage(sector: number) {
    if (sector === 99) return "/deathgate-sector.webp";

    const village = villageForOutskirtsSector(sector);
    if (village) return villagePageImage(village);

    switch (sectorImageTheme(sector)) {
        case "ice": return iceSectorImg;
        case "dark": return darkSectorImg;
        case "temple": return templeSectorImg;
        case "water": return waterSectorImg;
        case "stormveil": return stormveilVillageImg;
        case "forrest": return forrestSectorImg;
        case "meadow2": return meadow2SectorImg;
        default: return meadowSectorImg;
    }
}

// Depth-map URL for a sector's painted scene, when one has been baked
// (scripts/gen-sector-depth.mjs). Mirrors sectorBackgroundImage's image choice
// so the depth lines up with what's shown: only theme images have maps for now —
// village outskirts, Death's Gate, and custom territory art fall back to the
// procedural depth in SectorScene3DScene.
function sectorDepthImage(sector: number): string | undefined {
    if (sector === 99) return undefined;
    if (villageForOutskirtsSector(sector)) return undefined;
    const theme = sectorImageTheme(sector);
    return SECTOR_DEPTH_THEMES.has(theme) ? `/sector-depth/${theme}.webp` : undefined;
}

/*
 * The painted top-down ADVENTURE MAP for a sector. Every sector 1-66 plus
 * Death's Gate (99) now has bespoke art, so this is a straight lookup — the ten
 * shared per-biome variant boards it used to fall back to were deleted
 * 2026-07-29 once s99 got its own board (it was the last consumer).
 *
 * Art files keep their pre-renumbering names, so resolve through sectorArtKey.
 */
function sectorMapUrl(_biome: Biome, seed: number): string | undefined {
    const artKey = sectorArtKey(seed);
    return SECTOR_FLOOR_SECTORS.has(artKey) ? `/sector-map/s${artKey}.webp` : undefined;
}

// Ambience biome (drives drifting particles + god-ray tint) chosen to match the
// painted scene image — NOT the territory biome, which can differ (e.g. a
// volcano-territory sector that paints as forest). Outskirts mirror their village.
function ambienceBiomeForSector(sector: number): Biome {
    if (sector === 99) return "volcano";
    // Every wild sector has painted floor art, and its painted region IS its
    // gameplay biome now (shared/sector-geo.ts), so ambience reads straight off
    // the registry. The village/theme fallbacks below only serve sector 0 and
    // any id outside the registry.
    if (sector >= 1) return biomeForWorldSector(sector);
    const village = villageForOutskirtsSector(sector);
    if (village === "Frostfang Village") return "snow";
    if (village === "Moonshadow Village") return "shadow";
    if (village === "Stormveil Village") return "forest";
    if (village === "Ashen Leaf Village") return "volcano";
    switch (sectorImageTheme(sector)) {
        case "ice": return "snow";
        case "dark": return "shadow";
        case "temple": return "shadow";   // cherry-blossom temple → drifting petals
        case "forrest": return "forest";
        case "stormveil": return "forest";
        case "water": return "central";   // soft motes over the lagoon
        case "meadow2": return "central";
        case "meadow": return "central";
        default: return "central";
    }
}

export {
    sectorBackgroundImage,
    sectorDepthImage,
    sectorMapUrl,
    ambienceBiomeForSector,
};
