/*
 * Cinderhold — the fifth village, run entirely by NPC shinobi (2026-11-08).
 *
 * The single source of truth for what Cinderhold IS. It is deliberately NOT in
 * the player-village lists (WAR_VILLAGES, TRANSFER_VILLAGES, the character
 * creator's `villages`, KAGE_VILLAGES, VILLAGE_CHAT_NAMES): players cannot join
 * it, and no Kage, elder, transfer, war or treasury system sees it until its own
 * war phase adds an explicit `isNpcVillage` path.
 */
import { CINDERHOLD_GATE_SECTOR, CINDERHOLD_SECTORS } from './sector-geo.js';

export const NPC_VILLAGE = 'Cinderhold Village';
export const NPC_VILLAGE_SLUG = 'cinderhold';
export const NPC_VILLAGE_SHORT = 'Cinderhold';
/** The village's home block on the volcano cone; 67 is its gate. */
export const NPC_HOME_SECTORS: readonly number[] = CINDERHOLD_SECTORS;
export const NPC_GATE_SECTOR = CINDERHOLD_GATE_SECTOR;
/** Map accent: red, distinct from the four player villages and from the ordinary sector pins. */
export const NPC_VILLAGE_ACCENT = '#dc2626';

/** The four player villages Cinderhold tracks aggression toward. */
export const PLAYER_VILLAGES = ['Frostfang Village', 'Stormveil Village', 'Ashen Leaf Village', 'Moonshadow Village'] as const;
export type PlayerVillage = typeof PLAYER_VILLAGES[number];

export function isNpcVillage(village: unknown): boolean {
    if (typeof village !== 'string') return false;
    const v = village.trim().toLowerCase();
    return v === NPC_VILLAGE.toLowerCase() || v === NPC_VILLAGE_SLUG || v === NPC_VILLAGE_SHORT.toLowerCase();
}

export function isNpcHomeSector(sector: unknown): boolean {
    return typeof sector === 'number' && NPC_HOME_SECTORS.includes(Math.floor(sector));
}

/**
 * Whether this is Cinderhold attacking to take back one of its own home
 * sectors (68-74; its gate, 67, is never conquerable). Owner ruling
 * 2026-11-11, "Cinderhold retakes it": such a war is fought in Combat whatever
 * win-condition the player holder set (api/village/sector-war.ts declare), so
 * Cinderhold's shinobi, who fight by duelling, can win it.
 */
export function npcReclaimsHomeSector(attackerVillage: unknown, sector: unknown): boolean {
    return isNpcVillage(attackerVillage) && isNpcHomeSector(sector) && Math.floor(Number(sector)) !== NPC_GATE_SECTOR;
}
