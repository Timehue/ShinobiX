/*
 * World geography registry — the single source of truth for what each wild
 * sector IS: its name, region, gameplay biome, and which art files it wears.
 * Shared by client and server (like sector-links).
 *
 * ── The 2026-07 renumbering ──────────────────────────────────────────────────
 * Sector numbers were reorganized into contiguous region blocks so the map
 * reads coherently (owner-approved; pre-launch). Every PLACE (name, art, POIs,
 * shrine, war membership) survived — only its number changed:
 *
 *    1- 8  Stormveil Harbor      (gate first: 1 = Harbor Gates)
 *    9-16  Ashen Leaf Deepwood   (9 = Ashen Leaf Gates)
 *   17-25  Moonshadow Wilds      (17 = Moonshadow Gates)
 *   26-33  Frostfang Reach       (26 = Frostfang Gates)
 *   34-35  Frost Border          (ecotone: ice meets green)
 *   36-45  The Midlands          (green heart ring)
 *   46-51  The Castle City       (neutral keep: 46-50; 51 = East Ring Road)
 *   52-54  Festival Grounds      (54 = Sunscar Festival entrance)
 *   55-57  The Hollow Road       (dark pilgrim road; 57 = Hollow Temple)
 *   58-60  The Lavafront         (volcanic frontier)
 *      99  Death's Gate          (unchanged, map-travel-only)
 *
 * Numbers rise with danger/reward tier (chest scaling uses the sector number).
 *
 * `artKey` is the sector's ORIGINAL number — public/sector-map/s<artKey>.webp,
 * public/sector-scenes/s<artKey>.webp and public/sector-depth/s<artKey>.webp
 * keep their historical filenames (renaming 180 binary assets would churn the
 * repo for zero player value). Never rename those files; resolve art through
 * sectorArtKey().
 *
 * Biomes here follow the PAINTED map (the old numeric bands disagreed with the
 * geography for ~35 sectors — see docs/world-map-sectors-redesign-plan-2026-07-28.md
 * §1.4). This shifts weather/ambience/backdrops and the per-biome jutsu-type
 * multiplier on the re-labeled sectors (owner-approved realignment).
 */

export type SectorBiome = 'shadow' | 'forest' | 'volcano' | 'snow' | 'central';

export type SectorRegionKey =
    | 'stormveil' | 'ashenleaf' | 'moonshadow' | 'frostfang' | 'frostborder'
    | 'midlands' | 'castle' | 'festival' | 'hollowroad' | 'lavafront' | 'deathsgate';

export type SectorPlace = {
    /** Current (post-reorg) sector number. */
    id: number;
    /** Display name, e.g. "Canal Heart". */
    name: string;
    region: SectorRegionKey;
    /** Gameplay biome (weather, ambience, combat backdrop, biome multiplier). */
    biome: SectorBiome;
    /** Original sector number — keys the on-disk art files (s<artKey>.webp). */
    artKey: number;
};

export const SECTOR_REGION_LABELS: Readonly<Record<SectorRegionKey, string>> = {
    stormveil: 'Stormveil Harbor',
    ashenleaf: 'Ashen Leaf Deepwood',
    moonshadow: 'Moonshadow Wilds',
    frostfang: 'Frostfang Reach',
    frostborder: 'the Frost Border',
    midlands: 'the Midlands',
    castle: 'the Castle City',
    festival: 'the Festival Grounds',
    hollowroad: 'the Hollow Road',
    lavafront: 'the Lavafront',
    deathsgate: 'Death’s Gate',
};

export const SECTOR_PLACES: readonly SectorPlace[] = [
    // ── Stormveil Harbor (1-8) ── the tide village's stilt city and wetlands
    { id: 1, name: 'Harbor Gates', region: 'stormveil', biome: 'central', artKey: 31 },
    { id: 2, name: 'North Docks', region: 'stormveil', biome: 'central', artKey: 21 },
    { id: 3, name: 'Upper Terraces', region: 'stormveil', biome: 'central', artKey: 22 },
    { id: 4, name: 'Clocktower Hill', region: 'stormveil', biome: 'central', artKey: 34 },
    { id: 5, name: 'Reedmarsh Boardwalk', region: 'stormveil', biome: 'central', artKey: 24 },
    { id: 6, name: 'Eastern Stilts', region: 'stormveil', biome: 'central', artKey: 32 },
    { id: 7, name: 'Western Piers', region: 'stormveil', biome: 'central', artKey: 26 },
    { id: 8, name: 'Canal Heart', region: 'stormveil', biome: 'central', artKey: 27 },

    // ── Ashen Leaf Deepwood (9-16) ── emerald forest on the sea cliffs
    { id: 9, name: 'Ashen Leaf Gates', region: 'ashenleaf', biome: 'forest', artKey: 38 },
    { id: 10, name: 'Cliffside Deepwood', region: 'ashenleaf', biome: 'forest', artKey: 36 },
    { id: 11, name: 'Blossom Grove', region: 'ashenleaf', biome: 'forest', artKey: 37 },
    { id: 12, name: 'Canopy Heights', region: 'ashenleaf', biome: 'forest', artKey: 39 },
    { id: 13, name: 'Headland Woods', region: 'ashenleaf', biome: 'forest', artKey: 40 },
    { id: 14, name: 'Gorgeview Plateau', region: 'ashenleaf', biome: 'forest', artKey: 41 },
    { id: 15, name: 'Heartwood Shrine', region: 'ashenleaf', biome: 'forest', artKey: 42 },
    { id: 16, name: 'Fern Terraces', region: 'ashenleaf', biome: 'forest', artKey: 43 },

    // ── Moonshadow Wilds (17-25) ── the violet forest under the moon
    { id: 17, name: 'Moonshadow Gates', region: 'moonshadow', biome: 'shadow', artKey: 11 },
    { id: 18, name: 'Jade River Bridge', region: 'moonshadow', biome: 'shadow', artKey: 19 },
    { id: 19, name: 'Western Eaves', region: 'moonshadow', biome: 'shadow', artKey: 15 },
    { id: 20, name: 'Amethyst Canopy', region: 'moonshadow', biome: 'shadow', artKey: 4 },
    { id: 21, name: 'Moonstone Rise', region: 'moonshadow', biome: 'shadow', artKey: 5 },
    { id: 22, name: 'Moonlit Cove Cliffs', region: 'moonshadow', biome: 'shadow', artKey: 6 },
    { id: 23, name: 'Moongrotto', region: 'moonshadow', biome: 'shadow', artKey: 16 },
    { id: 24, name: 'Crystal Plaza', region: 'moonshadow', biome: 'shadow', artKey: 8 },
    { id: 25, name: 'Fallswood', region: 'moonshadow', biome: 'shadow', artKey: 17 },

    // ── Frostfang Reach (26-33) ── the glacier realm
    { id: 26, name: 'Frostfang Gates', region: 'frostfang', biome: 'snow', artKey: 47 },
    { id: 27, name: 'Far Glacier Shelf', region: 'frostfang', biome: 'snow', artKey: 46 },
    { id: 28, name: 'Needle Spires', region: 'frostfang', biome: 'snow', artKey: 48 },
    { id: 29, name: 'Highpass Peaks', region: 'frostfang', biome: 'snow', artKey: 49 },
    { id: 30, name: 'Glacier Terraces', region: 'frostfang', biome: 'snow', artKey: 50 },
    { id: 31, name: 'Shrinefall Shelf', region: 'frostfang', biome: 'snow', artKey: 53 },
    { id: 32, name: 'Knife-Edge Summit', region: 'frostfang', biome: 'snow', artKey: 54 },
    { id: 33, name: 'Cinderfrost Divide', region: 'frostfang', biome: 'volcano', artKey: 51 },

    // ── Frost Border (34-35) ── the ecotone where ice meets green land
    { id: 34, name: 'Icefall Cliffs', region: 'frostborder', biome: 'snow', artKey: 55 },
    { id: 35, name: 'Glacier Bridge', region: 'frostborder', biome: 'snow', artKey: 3 },

    // ── The Midlands (36-45) ── the green heart between the villages
    { id: 36, name: 'North Reach', region: 'midlands', biome: 'central', artKey: 44 },
    { id: 37, name: 'Crossway Hills', region: 'midlands', biome: 'central', artKey: 45 },
    { id: 38, name: 'Great Bridge Gorge', region: 'midlands', biome: 'central', artKey: 25 },
    { id: 39, name: 'Falls Overlook', region: 'midlands', biome: 'central', artKey: 23 },
    { id: 40, name: 'Goatstone Terraces', region: 'midlands', biome: 'central', artKey: 28 },
    { id: 41, name: 'Milestone Vale', region: 'midlands', biome: 'central', artKey: 29 },
    { id: 42, name: 'Teahouse Fields', region: 'midlands', biome: 'central', artKey: 30 },
    { id: 43, name: 'Windmill Fields', region: 'midlands', biome: 'central', artKey: 9 },
    { id: 44, name: 'Watchruin Ridge', region: 'midlands', biome: 'central', artKey: 10 },
    { id: 45, name: 'Southern Crossroads', region: 'midlands', biome: 'central', artKey: 20 },

    // ── The Castle City (46-51) ── the neutral indigo keep
    { id: 46, name: 'North Gate Plaza', region: 'castle', biome: 'central', artKey: 57 },
    { id: 47, name: 'West Gardens', region: 'castle', biome: 'central', artKey: 56 },
    { id: 48, name: 'Walled Garden', region: 'castle', biome: 'central', artKey: 58 },
    { id: 49, name: 'South Terraces', region: 'castle', biome: 'central', artKey: 59 },
    { id: 50, name: 'Grand Esplanade', region: 'castle', biome: 'central', artKey: 60 },
    { id: 51, name: 'East Ring Road', region: 'castle', biome: 'central', artKey: 1 },

    // ── Festival Grounds (52-54) ── the Sunscar Festival's dusk fields
    { id: 52, name: 'Festival Grounds', region: 'festival', biome: 'central', artKey: 14 },
    { id: 53, name: 'Boardwalk Scrub', region: 'festival', biome: 'central', artKey: 33 },
    { id: 54, name: 'Cactus Flats', region: 'festival', biome: 'central', artKey: 35 },

    // ── The Hollow Road (55-57) ── the darkening pilgrim road to the Gate
    { id: 55, name: 'Waymarker Road', region: 'hollowroad', biome: 'shadow', artKey: 12 },
    { id: 56, name: 'Pilgrim’s Approach', region: 'hollowroad', biome: 'shadow', artKey: 13 },
    { id: 57, name: 'Hollow Temple', region: 'hollowroad', biome: 'shadow', artKey: 18 },

    // ── The Lavafront (58-60) ── the volcanic frontier below Death's Gate
    { id: 58, name: 'Cinder Foothills', region: 'lavafront', biome: 'volcano', artKey: 7 },
    { id: 59, name: 'Northroad Saddle', region: 'lavafront', biome: 'volcano', artKey: 2 },
    { id: 60, name: 'Obsidian Forecourt', region: 'lavafront', biome: 'volcano', artKey: 52 },

    // ── Death's Gate (99) ── the lava arena; number unchanged, map-travel-only
    { id: 99, name: 'The Lavafront Gate', region: 'deathsgate', biome: 'volcano', artKey: 99 },
];

const PLACE_BY_ID: ReadonlyMap<number, SectorPlace> = new Map(SECTOR_PLACES.map((p) => [p.id, p]));

/** OLD sector number → NEW sector number (the 2026-07 renumbering, 99→99). */
export const OLD_TO_NEW_SECTOR: Readonly<Record<number, number>> = (() => {
    const m: Record<number, number> = {};
    for (const p of SECTOR_PLACES) m[p.artKey] = p.id;
    return m;
})();

/** NEW sector number → OLD sector number (= artKey). */
export const NEW_TO_OLD_SECTOR: Readonly<Record<number, number>> = (() => {
    const m: Record<number, number> = {};
    for (const p of SECTOR_PLACES) m[p.id] = p.artKey;
    return m;
})();

export function sectorPlace(sector: number): SectorPlace | undefined {
    return PLACE_BY_ID.get(Math.floor(sector));
}

/** Display name for a wild sector, or undefined (sector 0 = village interior). */
export function sectorName(sector: number): string | undefined {
    return PLACE_BY_ID.get(Math.floor(sector))?.name;
}

/** Gameplay biome for a wild sector. Defaults to 'central' off-map (sector 0). */
export function sectorBiomeOf(sector: number): SectorBiome {
    return PLACE_BY_ID.get(Math.floor(sector))?.biome ?? 'central';
}

export function sectorRegionKey(sector: number): SectorRegionKey | undefined {
    return PLACE_BY_ID.get(Math.floor(sector))?.region;
}

/** "the Midlands"-style display label for a sector's region. */
export function sectorRegionLabel(sector: number): string | undefined {
    const region = PLACE_BY_ID.get(Math.floor(sector))?.region;
    return region ? SECTOR_REGION_LABELS[region] : undefined;
}

/** The historical number that keys this sector's on-disk art (s<artKey>.webp). */
export function sectorArtKey(sector: number): number {
    return PLACE_BY_ID.get(Math.floor(sector))?.artKey ?? Math.floor(sector);
}

/**
 * Remap a sector number stored before the renumbering. Old and new numbering
 * share the 1-60 (+0/99) range, so this is only safe behind a version check —
 * see worldGeoVersion below. 0 (village) and 99 (Death's Gate) are unchanged;
 * anything unknown falls back to 0 (the village) rather than a wrong place.
 */
export function remapLegacySector(sector: number): number {
    const s = Math.floor(sector);
    if (s === 0 || s === 99) return s;
    return OLD_TO_NEW_SECTOR[s] ?? 0;
}

/**
 * Save-record geography version. Records without `worldGeoV: 2` carry
 * pre-renumbering sector fields and must be passed through remapLegacySector
 * exactly once (api/_elapsed-state.ts settleSaveRecord does this on read).
 */
export const WORLD_GEO_VERSION = 2;

/** Travelling to this sector opens the Sunscar Festival screen (the place that
 *  has always sat on the painted festival tents — old sector 35). */
export const FESTIVAL_SECTOR = 54;

/** Village name → its outskirts sector (the first number of its region block). */
export const VILLAGE_OUTSKIRTS: Readonly<Record<string, number>> = {
    'Stormveil Village': 1,
    'Ashen Leaf Village': 9,
    'Moonshadow Village': 17,
    'Frostfang Village': 26,
};

/** All four outskirts numbers (rift targeting skips these). */
export const OUTSKIRTS_SECTORS: readonly number[] = [1, 9, 17, 26];

/** The neutral castle-city block (rift targeting skips these too). */
export const CASTLE_SECTORS: readonly number[] = [46, 47, 48, 49, 50, 51];
