"use strict";
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
 * `left`/`top` are the standee's percent position on the sector board.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHRINE_MAX_OFFERING = exports.SHRINE_MIN_OFFERING = exports.SHRINE_TIERS = exports.SHRINE_DEFS = void 0;
exports.shrineForSector = shrineForSector;
exports.shrineById = shrineById;
exports.shrineTier = shrineTier;
exports.SHRINE_DEFS = [
    // ——— The four village shrines ———
    {
        id: 'heartwood', sector: 42, name: 'Heartwood Shrine', theme: 'village', village: 'Ashen Leaf Village',
        region: 'the Ashen Leaf Deepwood',
        lore: 'Raised by Ashen Leaf’s first woodwardens around a living tree; they say its roots reach all the way back to the village square.',
        blessing: 'May your roots hold and your leaves reach.',
        left: 30, top: 26,
    },
    {
        id: 'tide', sector: 34, name: 'Tidecaller Shrine', theme: 'village', village: 'Stormveil Village',
        region: 'the Stormveil Heights',
        lore: 'Stormveil’s fishers ring its bronze bell before every voyage. The tide is said to answer those who give before they ask.',
        blessing: 'May the tide carry your burdens out.',
        left: 68, top: 24,
    },
    {
        id: 'frostveil', sector: 53, name: 'Frostveil Shrine', theme: 'village', village: 'Frostfang Village',
        region: 'the Frostreach Shelf',
        lore: 'Carved by Frostfang’s founders from the first ice of their first winter. An offering made here is frozen bright inside it forever.',
        blessing: 'May the cold keep what you cherish.',
        left: 32, top: 28,
    },
    {
        id: 'moonwell', sector: 16, name: 'Moonwell Shrine', theme: 'village', village: 'Moonshadow Village',
        region: 'the Moonshadow Wilds',
        lore: 'Moonshadow’s seers filled its basin with caught moonlight. It keeps every secret the village dares not say aloud.',
        blessing: 'May the moon light the path you hide.',
        left: 66, top: 26,
    },
    // ——— The Hollow Gate ward ———
    {
        id: 'hollowgate', sector: 13, name: 'Hollow Warden Shrine', theme: 'hollow-gate',
        region: 'the Pilgrim’s Approach',
        lore: 'Pilgrims raised it where the lantern road fails, a ward on the path down to the Gate. Every offering feeds the seal a little longer.',
        blessing: 'May the Gate stay shut behind you.',
        left: 64, top: 24,
    },
    // ——— The Ancients (the hundred legacies) ———
    {
        id: 'ancients', sector: 10, name: 'Shrine of the Ancients', theme: 'ancients',
        region: 'the Watchruin Ridge',
        lore: 'Older than the villages. A hundred worn glyphs circle its base — one for every path the Ancients walked, the legacies shinobi still chase.',
        blessing: 'May the Ancients find their path in you.',
        left: 34, top: 26,
    },
];
/** Cosmetic shrine tiers — lifetime-total ryo thresholds. Pure display, no payouts. */
exports.SHRINE_TIERS = [
    { name: 'Dormant', at: 0 },
    { name: 'Kindled', at: 25_000 },
    { name: 'Blessed', at: 100_000 },
    { name: 'Radiant', at: 500_000 },
    { name: 'Mythic', at: 2_000_000 },
];
exports.SHRINE_MIN_OFFERING = 10;
exports.SHRINE_MAX_OFFERING = 250_000;
const BY_SECTOR = new Map(exports.SHRINE_DEFS.map((d) => [d.sector, d]));
const BY_ID = new Map(exports.SHRINE_DEFS.map((d) => [d.id, d]));
function shrineForSector(sector) {
    return BY_SECTOR.get(sector);
}
function shrineById(id) {
    return BY_ID.get(id);
}
/** 0-based tier index for a lifetime offering total. */
function shrineTier(totalRyo) {
    let tier = 0;
    for (let i = 0; i < exports.SHRINE_TIERS.length; i += 1) {
        if (totalRyo >= exports.SHRINE_TIERS[i].at)
            tier = i;
    }
    return tier;
}
