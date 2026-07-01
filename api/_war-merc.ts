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
import { wrMercTierById, comebackCostMultiplier, mercBandSize } from './_war-economy.js';
import { mercCostMultiplier } from './_war-structures.js';
import type { VillageWarRecord, MercLease } from './_war-state.js';

// A merc contract lasts 2 days (the §6.3 "2-day contract").
export const MERC_LEASE_MS = 2 * 24 * 60 * 60 * 1000;

/** WR to hire `tierId` for a village holding `sectorsHeld` sectors: the tier's
 *  base cost × the comeback discount (0 sectors → free / 1 → 75% off / ≥2 → full)
 *  × the Barracks discount. Rounded, floored at 0. Returns 0 for an unknown tier
 *  (the caller rejects the hire before that matters). */
export function mercHireCost(tierId: string, sectorsHeld: number, record: VillageWarRecord): number {
    const tier = wrMercTierById(tierId);
    if (!tier) return 0;
    const afterComeback = tier.costWr * comebackCostMultiplier(sectorsHeld);
    const afterBarracks = afterComeback * mercCostMultiplier(record);
    return Math.max(0, Math.round(afterBarracks));
}

/** Add (or refresh) a player's lease for a tier: a single active lease per
 *  (tier, player), its 2-day clock restarted on re-hire. Pure. */
export function addOrRefreshLease(leases: readonly MercLease[], tierId: string, player: string, now: number): MercLease[] {
    const next = leases.filter((l) => !(l.tierId === tierId && l.player === player));
    next.push({ tierId, player, expiresAt: now + MERC_LEASE_MS, count: mercBandSize(tierId) });
    return next;
}

/** Whether `player` holds an active (unexpired) lease for `tierId` at `now`. */
export function hasActiveLease(record: VillageWarRecord, tierId: string, player: string, now: number): boolean {
    return record.mercLeases.some((l) => l.tierId === tierId && l.player === player && l.expiresAt > now);
}

/** Remove a player's lease for a tier (consumed after the merc fights). Pure. */
export function consumeLease(leases: readonly MercLease[], tierId: string, player: string): MercLease[] {
    return leases.filter((l) => !(l.tierId === tierId && l.player === player));
}

/** Claim ONE merc from the caller's active band for a deployment: decrement the
 *  band count, dropping the lease entirely when it hits 0. Each merc attack spends
 *  one merc (win, lose, or stall), so a 3-5 band = 3-5 attacks. Returns whether a
 *  merc was available + how many remain. Pure. */
export function claimMercFromBand(
    leases: readonly MercLease[],
    tierId: string,
    player: string,
    now: number,
): { leases: MercLease[]; claimed: boolean; remaining: number } {
    const next = leases.map((l) => ({ ...l }));
    const lease = next.find((l) => l.tierId === tierId && l.player === player && l.expiresAt > now);
    if (!lease || lease.count <= 0) return { leases: next, claimed: false, remaining: 0 };
    lease.count -= 1;
    const remaining = lease.count;
    const pruned = remaining > 0 ? next : next.filter((l) => !(l.tierId === tierId && l.player === player));
    return { leases: pruned, claimed: true, remaining };
}
