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
 *
 * Cinderhold (the NPC village, shared/npc-village.ts) fights SECTOR wars
 * (Push 4, 2026-11-10) but is not one of the four player war villages: it is in
 * SECTOR_WAR_VILLAGES and the sector tables, never in WAR_VILLAGES, so the
 * WR faucet, Kage seats, elders, tax, treasury and village-war loops that walk
 * WAR_VILLAGES still never see it.
 */
import { NPC_GATE_SECTOR, NPC_HOME_SECTORS, NPC_VILLAGE } from '../shared/npc-village.js';

export type WarVillage =
    | 'Moonshadow Village'
    | 'Stormveil Village'
    | 'Ashen Leaf Village'
    | 'Frostfang Village';
/** A village that can hold, attack and defend sectors: the four, plus Cinderhold. */
export type SectorWarVillage = WarVillage | 'Cinderhold Village';

export const WAR_VILLAGES: readonly WarVillage[] = [
    'Moonshadow Village', 'Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village',
];
export const SECTOR_WAR_VILLAGES: readonly SectorWarVillage[] = [...WAR_VILLAGES, NPC_VILLAGE as 'Cinderhold Village'];

// Home sectors per village — all 8 capturable. Outskirts anchor listed first. §4.
export const HOME_SECTORS: Record<WarVillage, readonly number[]> = {
    'Moonshadow Village': [17, 18, 19, 20, 21, 22, 23, 24],
    'Stormveil Village': [1, 2, 3, 4, 5, 6, 7, 8],
    'Ashen Leaf Village': [9, 10, 11, 12, 13, 14, 15, 16],
    'Frostfang Village': [26, 27, 28, 29, 30, 33, 31, 32],
};
/** Cinderhold's block, gate first (its permanent foothold, like every village gate). */
const NPC_WAR_HOME_SECTORS: readonly number[] = [NPC_GATE_SECTOR, ...NPC_HOME_SECTORS.filter((s) => s !== NPC_GATE_SECTOR)];
const SECTOR_WAR_HOME: Record<SectorWarVillage, readonly number[]> = { ...HOME_SECTORS, 'Cinderhold Village': NPC_WAR_HOME_SECTORS };

/** The first home-sector entry is that village's gate and permanent foothold. */
export const PROTECTED_HOME_SECTORS: readonly number[] = SECTOR_WAR_VILLAGES.map((village) => SECTOR_WAR_HOME[village][0]);

// `AL-n`-style alias prefix per village.
export const VILLAGE_ALIAS_PREFIX: Record<SectorWarVillage, string> = {
    'Ashen Leaf Village': 'AL',
    'Frostfang Village': 'FF',
    'Stormveil Village': 'SV',
    'Moonshadow Village': 'MS',
    'Cinderhold Village': 'CH',
};

// Each village's home biome (default sector terrain). Mirrors village-biomes.ts.
export const VILLAGE_BIOME: Record<SectorWarVillage, 'shadow' | 'forest' | 'volcano' | 'snow'> = {
    'Moonshadow Village': 'shadow',
    'Stormveil Village': 'forest',
    'Ashen Leaf Village': 'volcano',
    'Frostfang Village': 'snow',
    'Cinderhold Village': 'volcano',
};

// The neutral central keep — not owned, not capturable, not counted (§4).
export const CENTRAL_SECTORS: readonly number[] = [46, 47, 48, 49, 50];

// Special sectors that are never war sectors (Hollow-Gate shrine sectors —
// East Ring Road 51, Obsidian Forecourt 60, North Gate Plaza 46 — the Sunscar
// Festival at 54, Death's Gate). The festival is a neutral POI, not a territory.
export const NON_WAR_SPECIAL_SECTORS: readonly number[] = [46, 51, 54, 60, 99];

const SECTOR_TO_VILLAGE: ReadonlyMap<number, SectorWarVillage> = (() => {
    const m = new Map<number, SectorWarVillage>();
    for (const v of SECTOR_WAR_VILLAGES) for (const s of SECTOR_WAR_HOME[v]) m.set(s, v);
    return m;
})();

function asSector(n: number): number {
    return Math.floor(Number(n) || 0);
}

/** One of the four PLAYER war villages (Kage seats, village wars, WR faucet). */
export function isWarVillage(v: string): v is WarVillage {
    return (WAR_VILLAGES as readonly string[]).includes(v);
}

/** A village that can declare, defend and hold sector wars: the four, plus Cinderhold. */
export function isSectorWarVillage(v: string): v is SectorWarVillage {
    return (SECTOR_WAR_VILLAGES as readonly string[]).includes(v);
}

export function homeSectorsForVillage(village: string): readonly number[] {
    return SECTOR_WAR_HOME[village as SectorWarVillage] ?? [];
}

/** The village a sector is a HOME sector of (undefined for neutral/special). */
export function homeVillageForSector(sector: number): SectorWarVillage | undefined {
    return SECTOR_TO_VILLAGE.get(asSector(sector));
}

/** True for the 40 home war sectors (Cinderhold's 67–74 included); false for central/special/wilderness. */
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
    const idx = SECTOR_WAR_HOME[v].indexOf(s);
    return `${VILLAGE_ALIAS_PREFIX[v]}-${idx + 1}`;
}
