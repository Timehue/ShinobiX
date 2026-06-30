"use strict";
/*
 * Village War Map — sector↔village ownership table + mappers (Phase 0, pure).
 *
 * Which EXISTING world sectors each village owns at the start of the war-map
 * layer (plan §4). The neutral central band (56-60) and special sectors
 * (Hollow-Gate shrines 1/52/57, Sunscar Festival 35, Death's Gate 99) are NOT war sectors. All 8 home
 * sectors per village are capturable (no protected core, no floor). The canonical
 * key is always the world-sector number; `AL-n`-style labels are display aliases.
 *
 * IO-free. The client mirror (shinobij.client/src/data/war-map-sectors.ts) must
 * stay in sync for the UI. Mirrors the biome bands in
 * shinobij.client/src/data/sectors.ts (shadow 1-20, forest 21-35, volcano 36-45,
 * snow 46-55, central 56-60).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_WAR_SPECIAL_SECTORS = exports.CENTRAL_SECTORS = exports.VILLAGE_BIOME = exports.VILLAGE_ALIAS_PREFIX = exports.HOME_SECTORS = exports.WAR_VILLAGES = void 0;
exports.isWarVillage = isWarVillage;
exports.homeSectorsForVillage = homeSectorsForVillage;
exports.homeVillageForSector = homeVillageForSector;
exports.isWarSector = isWarSector;
exports.isCentralSector = isCentralSector;
exports.sectorAlias = sectorAlias;
exports.WAR_VILLAGES = [
    'Moonshadow Village', 'Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village',
];
// Home sectors per village — all 8 capturable. Outskirts anchor listed first. §4.
exports.HOME_SECTORS = {
    'Moonshadow Village': [11, 19, 15, 4, 5, 6, 16, 8],
    'Stormveil Village': [31, 21, 22, 34, 24, 32, 26, 27],
    'Ashen Leaf Village': [38, 36, 37, 39, 40, 41, 42, 43],
    'Frostfang Village': [47, 46, 48, 49, 50, 51, 53, 54],
};
// `AL-n`-style alias prefix per village.
exports.VILLAGE_ALIAS_PREFIX = {
    'Ashen Leaf Village': 'AL',
    'Frostfang Village': 'FF',
    'Stormveil Village': 'SV',
    'Moonshadow Village': 'MS',
};
// Each village's home biome (default sector terrain). Mirrors village-biomes.ts.
exports.VILLAGE_BIOME = {
    'Moonshadow Village': 'shadow',
    'Stormveil Village': 'forest',
    'Ashen Leaf Village': 'volcano',
    'Frostfang Village': 'snow',
};
// The neutral central keep — not owned, not capturable, not counted (§4).
exports.CENTRAL_SECTORS = [56, 57, 58, 59, 60];
// Special sectors that are never war sectors (Hollow-Gate shrines, the Sunscar
// Festival at 35, Death's Gate). The festival is a neutral POI, not a territory.
exports.NON_WAR_SPECIAL_SECTORS = [1, 35, 52, 57, 99];
const SECTOR_TO_VILLAGE = (() => {
    const m = new Map();
    for (const v of exports.WAR_VILLAGES)
        for (const s of exports.HOME_SECTORS[v])
            m.set(s, v);
    return m;
})();
function asSector(n) {
    return Math.floor(Number(n) || 0);
}
function isWarVillage(v) {
    return exports.WAR_VILLAGES.includes(v);
}
function homeSectorsForVillage(village) {
    return exports.HOME_SECTORS[village] ?? [];
}
/** The village a sector is a HOME sector of (undefined for neutral/special). */
function homeVillageForSector(sector) {
    return SECTOR_TO_VILLAGE.get(asSector(sector));
}
/** True for the 32 home war sectors; false for central/special/wilderness. */
function isWarSector(sector) {
    return SECTOR_TO_VILLAGE.has(asSector(sector));
}
function isCentralSector(sector) {
    return exports.CENTRAL_SECTORS.includes(asSector(sector));
}
/** `AL-1`-style display alias for a home sector (1-based index within the
 *  village's home list), or undefined if the sector is not a home sector. */
function sectorAlias(sector) {
    const s = asSector(sector);
    const v = SECTOR_TO_VILLAGE.get(s);
    if (!v)
        return undefined;
    const idx = exports.HOME_SECTORS[v].indexOf(s);
    return `${exports.VILLAGE_ALIAS_PREFIX[v]}-${idx + 1}`;
}
