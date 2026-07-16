"use strict";
/**
 * Sector shrines — shared config for client and server.
 *
 * A handful of wild sectors host a communal shrine: a pure ryo SINK players can
 * offer to for prestige (weekly top-offerer board + a cosmetic shrine tier that
 * everyone visiting the sector sees). No rewards are paid out — the server only
 * ever debits, so there is nothing to exploit. One shrine per painted world-map
 * region, deliberately mid-route (never a village-gate sector) so visiting is a
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
    { id: 'heartwood', sector: 42, name: 'Heartwood Shrine', region: 'the Ashen Leaf Deepwood', blessing: 'May your roots hold and your leaves reach.', left: 30, top: 26 },
    { id: 'tide', sector: 34, name: 'Tide Shrine', region: 'the Stormveil Heights', blessing: 'May the tide carry your burdens out.', left: 68, top: 24 },
    { id: 'frostveil', sector: 53, name: 'Frostveil Shrine', region: 'the Frostreach Shelf', blessing: 'May the cold keep what you cherish.', left: 32, top: 28 },
    { id: 'moonwell', sector: 16, name: 'Moonwell Shrine', region: 'the Moonshadow Wilds', blessing: 'May the moon light the path you hide.', left: 66, top: 26 },
    { id: 'gilded', sector: 58, name: 'Gilded Garden Shrine', region: 'the Castle Gardens', blessing: 'May your works outlast their gold.', left: 30, top: 24 },
    { id: 'cinderfrost', sector: 51, name: 'Cinderfrost Shrine', region: 'the Cinderfrost Divide', blessing: 'May you endure both fire and frost.', left: 50, top: 22 },
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
