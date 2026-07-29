/**
 * Sector shrines — shared config for client and server.
 *
 * Six themed communal shrines: one raised by each of the four villages (standing
 * in that village's stretch of the world), one warding the road to the Hollow
 * Gate, and one older than all of them that speaks of the Ancients — the hundred
 * legacies. Each is a pure ryo SINK players can offer to for prestige (weekly
 * top-offerer board + a cosmetic shrine tier everyone visiting the sector sees).
 * No rewards are paid out — the server only ever debits, so there is nothing to
 * exploit. All sit mid-route (never a village-gate sector) so visiting is a
 * small pilgrimage.
 *
 * Ids are stable KV key components (`world:shrine:<id>`) — never rename one.
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
        id: 'heartwood', sector: 42, name: 'Heartwood Shrine', theme: 'village', village: 'Ashen Leaf Village',
        region: 'the Ashen Leaf Deepwood',
        lore: 'Raised by Ashen Leaf’s first woodwardens around a living tree; they say its roots reach all the way back to the village square.',
        blessing: 'May your roots hold and your leaves reach.',
        left: 54, top: 44,
    },
    {
        id: 'tide', sector: 34, name: 'Tidecaller Shrine', theme: 'village', village: 'Stormveil Village',
        region: 'the Stormveil Heights',
        lore: 'Stormveil’s fishers ring its bronze bell before every voyage. The tide is said to answer those who give before they ask.',
        blessing: 'May the tide carry your burdens out.',
        left: 33, top: 44,
    },
    {
        id: 'frostveil', sector: 53, name: 'Frostveil Shrine', theme: 'village', village: 'Frostfang Village',
        region: 'the Frostreach Shelf',
        lore: 'Carved by Frostfang’s founders from the first ice of their first winter. An offering made here is frozen bright inside it forever.',
        blessing: 'May the cold keep what you cherish.',
        left: 26, top: 45,
    },
    {
        id: 'moonwell', sector: 16, name: 'Moonwell Shrine', theme: 'village', village: 'Moonshadow Village',
        region: 'the Moonshadow Wilds',
        lore: 'Moonshadow’s seers filled its basin with caught moonlight. It keeps every secret the village dares not say aloud.',
        blessing: 'May the moon light the path you hide.',
        left: 54, top: 58,
    },
    // ——— The Hollow Gate ward ———
    {
        id: 'hollowgate', sector: 13, name: 'Hollow Gate Shrine', theme: 'hollow-gate',
        region: 'the Pilgrim’s Approach',
        lore: 'Pilgrims raised it where the lantern road fails, a ward on the path down to the Gate. Every offering feeds the seal a little longer.',
        blessing: 'May the Gate stay shut behind you.',
        left: 28, top: 46,
    },
    // ——— The Ancients (the hundred legacies) ———
    {
        id: 'ancients', sector: 10, name: 'Shrine of the Ancients', theme: 'ancients',
        region: 'the Watchruin Ridge',
        lore: 'Older than the villages. A hundred worn glyphs circle its base — one for every path the Ancients walked, the legacies shinobi still chase.',
        blessing: 'May the Ancients find their path in you.',
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
