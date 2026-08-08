/*
 * Village War Map — sector↔village ownership table + mappers (Phase 0, pure).
 *
 * Which EXISTING world sectors each village owns at the start of the war-map
 * layer (plan §4). The neutral castle keep and special sectors (Hollow-Gate
 * shrine sectors, the Sunscar Festival, Death's Gate 99) are NOT war sectors.
 * Seven home sectors per village are capturable. Each village gate is a protected
 * core so a faction can lose a war without being erased from the political map.
 * The canonical key is always the world-sector number; `AL-n`-style labels are
 * display aliases.
 *
 * Sector numbers use the 2026-07 region-block renumbering — each village's
 * block starts at its own gate (shared/sector-geo.ts holds the registry and
 * the old↔new mapping; api/_sector-geo.test.ts pins that these are the same
 * PLACES as before the reorg).
 *
 * IO-free. The client mirror (shinobij.client/src/data/war-map-sectors.ts) must
 * stay in sync for the UI.
 */

export type WarVillage =
    | 'Moonshadow Village'
    | 'Stormveil Village'
    | 'Ashen Leaf Village'
    | 'Frostfang Village';

export const WAR_VILLAGES: readonly WarVillage[] = [
    'Moonshadow Village', 'Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village',
];

// Home sectors per village — all 8 capturable. Outskirts anchor listed first. §4.
export const HOME_SECTORS: Record<WarVillage, readonly number[]> = {
    'Moonshadow Village': [17, 18, 19, 20, 21, 22, 23, 24],
    'Stormveil Village': [1, 2, 3, 4, 5, 6, 7, 8],
    'Ashen Leaf Village': [9, 10, 11, 12, 13, 14, 15, 16],
    'Frostfang Village': [26, 27, 28, 29, 30, 33, 31, 32],
};

/** The first home-sector entry is that village's gate and permanent foothold. */
export const PROTECTED_HOME_SECTORS: readonly number[] = WAR_VILLAGES.map((village) => HOME_SECTORS[village][0]);

// `AL-n`-style alias prefix per village.
export const VILLAGE_ALIAS_PREFIX: Record<WarVillage, string> = {
    'Ashen Leaf Village': 'AL',
    'Frostfang Village': 'FF',
    'Stormveil Village': 'SV',
    'Moonshadow Village': 'MS',
};

// Each village's home biome (default sector terrain). Mirrors village-biomes.ts.
export const VILLAGE_BIOME: Record<WarVillage, 'shadow' | 'forest' | 'volcano' | 'snow'> = {
    'Moonshadow Village': 'shadow',
    'Stormveil Village': 'forest',
    'Ashen Leaf Village': 'volcano',
    'Frostfang Village': 'snow',
};

// The neutral central keep — not owned, not capturable, not counted (§4).
export const CENTRAL_SECTORS: readonly number[] = [46, 47, 48, 49, 50];

// Special sectors that are never war sectors (Hollow-Gate shrine sectors —
// East Ring Road 51, Obsidian Forecourt 60, North Gate Plaza 46 — the Sunscar
// Festival at 54, Death's Gate). The festival is a neutral POI, not a territory.
export const NON_WAR_SPECIAL_SECTORS: readonly number[] = [46, 51, 54, 60, 99];

const SECTOR_TO_VILLAGE: ReadonlyMap<number, WarVillage> = (() => {
    const m = new Map<number, WarVillage>();
    for (const v of WAR_VILLAGES) for (const s of HOME_SECTORS[v]) m.set(s, v);
    return m;
})();

function asSector(n: number): number {
    return Math.floor(Number(n) || 0);
}

export function isWarVillage(v: string): v is WarVillage {
    return (WAR_VILLAGES as readonly string[]).includes(v);
}

export function homeSectorsForVillage(village: string): readonly number[] {
    return HOME_SECTORS[village as WarVillage] ?? [];
}

/** The village a sector is a HOME sector of (undefined for neutral/special). */
export function homeVillageForSector(sector: number): WarVillage | undefined {
    return SECTOR_TO_VILLAGE.get(asSector(sector));
}

/** True for the 32 home war sectors; false for central/special/wilderness. */
export function isWarSector(sector: number): boolean {
    return SECTOR_TO_VILLAGE.has(asSector(sector));
}

/** A village gate can be configured and defended, but never conquered. */
export function isProtectedWarSector(sector: number): boolean {
    return PROTECTED_HOME_SECTORS.includes(asSector(sector));
}

export function isCentralSector(sector: number): boolean {
    return CENTRAL_SECTORS.includes(asSector(sector));
}

/** `AL-1`-style display alias for a home sector (1-based index within the
 *  village's home list), or undefined if the sector is not a home sector. */
export function sectorAlias(sector: number): string | undefined {
    const s = asSector(sector);
    const v = SECTOR_TO_VILLAGE.get(s);
    if (!v) return undefined;
    const idx = HOME_SECTORS[v].indexOf(s);
    return `${VILLAGE_ALIAS_PREFIX[v]}-${idx + 1}`;
}
