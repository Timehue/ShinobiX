"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERC_LEASE_MS = void 0;
exports.mercHireCost = mercHireCost;
exports.addOrRefreshLease = addOrRefreshLease;
exports.hasActiveLease = hasActiveLease;
exports.consumeLease = consumeLease;
exports.claimMercFromBand = claimMercFromBand;
/*
 * Village-War mercenaries — pure cost + lease math (Phase 5, §17.5 "Option B").
 *
 * Hiring a tier fields a 2-day AI shinobi squad that fights FOR the village in
 * Combat sector wars. This module is the IO-free economy core: the WR hire cost
 * (tier base × comeback discount × Barracks discount) and the merc-lease helpers
 * the /api/village/war-merc endpoint mutates under a lock. The AI-fighter
 * construction + the headless battle resolution live separately (built next, on
 * top of the Battle Towers engine).
 *
 * Behind ENABLE_VILLAGE_WAR — nothing live imports the endpoint until launch.
 */
const _war_economy_js_1 = require("./_war-economy.js");
const _war_structures_js_1 = require("./_war-structures.js");
// A merc contract lasts 2 days (the §6.3 "2-day contract").
exports.MERC_LEASE_MS = 2 * 24 * 60 * 60 * 1000;
/** WR to hire `tierId` for a village holding `sectorsHeld` sectors: the tier's
 *  base cost × the comeback discount (0 sectors → free / 1 → 75% off / ≥2 → full)
 *  × the Barracks discount. Rounded, floored at 0. Returns 0 for an unknown tier
 *  (the caller rejects the hire before that matters). */
function mercHireCost(tierId, sectorsHeld, record) {
    const tier = (0, _war_economy_js_1.wrMercTierById)(tierId);
    if (!tier)
        return 0;
    const afterComeback = tier.costWr * (0, _war_economy_js_1.comebackCostMultiplier)(sectorsHeld);
    const afterBarracks = afterComeback * (0, _war_structures_js_1.mercCostMultiplier)(record);
    return Math.max(0, Math.round(afterBarracks));
}
/** Add (or refresh) a player's lease for a tier: a single active lease per
 *  (tier, player), its 2-day clock restarted on re-hire. Pure. */
function addOrRefreshLease(leases, tierId, player, now) {
    const next = leases.filter((l) => !(l.tierId === tierId && l.player === player));
    next.push({ tierId, player, expiresAt: now + exports.MERC_LEASE_MS, count: (0, _war_economy_js_1.mercBandSize)(tierId) });
    return next;
}
/** Whether `player` holds an active (unexpired) lease for `tierId` at `now`. */
function hasActiveLease(record, tierId, player, now) {
    return record.mercLeases.some((l) => l.tierId === tierId && l.player === player && l.expiresAt > now);
}
/** Remove a player's lease for a tier (consumed after the merc fights). Pure. */
function consumeLease(leases, tierId, player) {
    return leases.filter((l) => !(l.tierId === tierId && l.player === player));
}
/** Claim ONE merc from the caller's active band for a deployment: decrement the
 *  band count, dropping the lease entirely when it hits 0. Each merc attack spends
 *  one merc (win, lose, or stall), so a 3-5 band = 3-5 attacks. Returns whether a
 *  merc was available + how many remain. Pure. */
function claimMercFromBand(leases, tierId, player, now) {
    const next = leases.map((l) => ({ ...l }));
    const lease = next.find((l) => l.tierId === tierId && l.player === player && l.expiresAt > now);
    if (!lease || lease.count <= 0)
        return { leases: next, claimed: false, remaining: 0 };
    lease.count -= 1;
    const remaining = lease.count;
    const pruned = remaining > 0 ? next : next.filter((l) => !(l.tierId === tierId && l.player === player));
    return { leases: pruned, claimed: true, remaining };
}
