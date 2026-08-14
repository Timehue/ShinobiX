/**
 * Sector shrines — shared config for client and server.
 *
 * Six themed communal shrines: one raised by each of the four villages (standing
 * in that village's stretch of the world), one warding the road to the Hollow
 * Gate, and one from the Sunken Court's age that records the Ancients, the
 * Withheld, and their hundred action-pattern Legacies. Each is a pure ryo SINK
 * players can offer to for prestige (weekly
 * top-offerer board + a cosmetic shrine tier everyone visiting the sector sees).
 * No rewards are paid out — the server only ever debits, so there is nothing to
 * exploit. All sit mid-route (never a village-gate sector) so visiting is a
 * short detour.
 *
 * Ids are stable KV key components (`world:shrine:<id>`) — never rename one.
 * Sector numbers follow the 2026-07 region-block renumbering (shared/sector-geo.ts);
 * each shrine stands in the same PLACE (same floor art via artKey) as before.
 * `left`/`top` are the standee's percent position on the sector board — each was
 * placed against its sector's actual floor art (composited QA renders, see
 * scripts/gen-sector-art.mjs) onto open, walkable-reading ground, clear of the
 * rift structure anchor (50%, 32%) and the war-vault anchor (72%, 38%).
 */

export type ShrineTheme = 'village' | 'hollow-gate' | 'ancients';

export type ShrineDef = {
    id: string;
    sector: number;
    name: string;
    theme: ShrineTheme;
    /** The village that raised it (village-theme shrines only). */
    village?: string;
    region: string;
    lore: string;
    blessing: string;
    left: number;
    top: number;
};

export const SHRINE_DEFS: readonly ShrineDef[] = [
    // ——— The four village shrines ———
    {
        id: 'heartwood', sector: 15, name: 'Heartwood Shrine', theme: 'village', village: 'Ashen Leaf Village',
        region: 'the Ashen Leaf Deepwood',
        lore: 'Raised by Ashen Leaf’s first woodwardens around a living tree; they say its roots reach all the way back to the village square.',
        blessing: 'May your roots hold and your leaves reach.',
        left: 54, top: 44,
    },
    {
        id: 'tide', sector: 4, name: 'Tidecaller Shrine', theme: 'village', village: 'Stormveil Village',
        region: 'the Stormveil Heights',
        lore: 'Stormveil’s fishers ring its bronze bell before every voyage. The tide is said to answer those who give before they ask.',
        blessing: 'May the tide carry your burdens out.',
        // Re-tuned against the 2026-07 keyart-style floor (grid-picked): the
        // open sand beach west of the pier — earlier spots landed in the water.
        left: 13, top: 68,
    },
    {
        id: 'frostveil', sector: 31, name: 'Frostveil Shrine', theme: 'village', village: 'Frostfang Village',
        region: 'the Frostreach Shelf',
        lore: 'Carved by Frostfang’s founders from the first ice of their first winter. An offering made here is frozen bright inside it forever.',
        blessing: 'May the cold keep what you cherish.',
        left: 26, top: 45,
    },
    {
        id: 'moonwell', sector: 23, name: 'Moonwell Shrine', theme: 'village', village: 'Moonshadow Village',
        region: 'the Moonshadow Wilds',
        lore: 'Moonshadow’s seers filled its basin with caught moonlight. It keeps every secret the village dares not say aloud.',
        blessing: 'May the moon light the path you hide.',
        // Re-tuned against the 2026-07 keyart-style floor (grid-picked): the
        // wide pale stone walkway — the old spot landed in the grotto pool.
        left: 60, top: 74,
    },
    // ——— The Hollow Gate ward ———
    {
        id: 'hollowgate', sector: 56, name: 'Hollow Gate Shrine', theme: 'hollow-gate',
        region: 'the Lantern Approach',
        lore: 'Shinobi wardens raised it where the lantern road fails, a seal on the path down to the Gate. Every offering keeps that seal intact a little longer.',
        blessing: 'May the Gate stay shut behind you.',
        // Re-tuned against the 2026-07 keyart-style floor (grid-picked): the
        // wide pale lantern road — the old spot perched on a rock outcrop.
        left: 58, top: 70,
    },
    // ——— The Ancients (the hundred legacies) ———
    {
        id: 'ancients', sector: 44, name: 'Shrine of the Ancients', theme: 'ancients',
        region: 'the Watchruin Ridge',
        lore: 'Raised in the Sunken Court’s age. A hundred worn glyphs circle its base, one for each action-pattern Legacy traced to the Ancients who refused cession, the people later called the Withheld.',
        blessing: 'May your next deed be freely chosen and faithfully witnessed.',
        left: 48, top: 45,
    },
];

/** Cosmetic shrine tiers — lifetime-total ryo thresholds. Pure display, no payouts. */
export const SHRINE_TIERS: readonly { name: string; at: number }[] = [
    { name: 'Dormant', at: 0 },
    { name: 'Kindled', at: 25_000 },
    { name: 'Blessed', at: 100_000 },
    { name: 'Radiant', at: 500_000 },
    { name: 'Mythic', at: 2_000_000 },
];

export const SHRINE_MIN_OFFERING = 10;
export const SHRINE_MAX_OFFERING = 250_000;

/** Apex pet traits authored for the Shrine blessing system. They stay outside
 * the ordinary wild/starter trait pool; breeding gets its own explicit rare
 * roll before choosing uniformly from this list. */
export const ULTRA_PET_TRAITS = ['Fateweaver', 'Hollowborn', 'Boonbringer'] as const;
export type UltraPetTrait = (typeof ULTRA_PET_TRAITS)[number];
export const BRED_ULTRA_TRAIT_DENOMINATOR = 200;
export const BRED_APEX_TRAIT_CHANCE_PERCENT = 100 / BRED_ULTRA_TRAIT_DENOMINATOR;

const BY_SECTOR = new Map(SHRINE_DEFS.map((d) => [d.sector, d]));
const BY_ID = new Map(SHRINE_DEFS.map((d) => [d.id, d]));

export function shrineForSector(sector: number): ShrineDef | undefined {
    return BY_SECTOR.get(sector);
}

export function shrineById(id: string): ShrineDef | undefined {
    return BY_ID.get(id);
}

/** 0-based tier index for a lifetime offering total. */
export function shrineTier(totalRyo: number): number {
    let tier = 0;
    for (let i = 0; i < SHRINE_TIERS.length; i += 1) {
        if (totalRyo >= SHRINE_TIERS[i].at) tier = i;
    }
    return tier;
}
