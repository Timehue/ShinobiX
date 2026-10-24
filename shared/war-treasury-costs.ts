/*
 * Treasury ryo and Bone Charms on war escalation (2026-10 rebalance, framework
 * 2.10 / #6).
 *
 * Mercenary hires and war preparations used to cost War Resources only, so the
 * treasury's ryo had no war-facing use. Each now also costs treasury ryo per WR
 * actually charged, after the comeback and Barracks discounts, so a free
 * comeback hire stays free. Preparations also cost treasury Bone Charms: the
 * tithe's daily charms had no spend path beyond Kage gifts.
 *
 * Shared by the server (which charges it) and the client panels (which show
 * it), so no price is hand-copied. The server's WAR_RYO_PER_WR dial can move the
 * rate at runtime; it sends the rate it charges in the war-map and merc-list
 * replies, and the client uses this module's default only when a reply has none.
 */

/** Treasury ryo per War Resource charged on a merc hire or a preparation tier. */
export const RYO_PER_WR = 250;
/** Treasury Bone Charms per War Resource on a preparation tier (20 / 40 / 60). */
export const PREP_BONE_CHARMS_PER_WR = 0.5;

function wholeNonNegative(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Treasury ryo for `wrCharged` War Resources at `ryoPerWr` (0 turns it off). */
export function treasuryRyoForWr(wrCharged: number, ryoPerWr: number = RYO_PER_WR): number {
    const rate = Number(ryoPerWr);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    return Math.round(wholeNonNegative(wrCharged) * rate);
}

/** Treasury Bone Charms for a preparation tier costing `wrCharged` WR. Zero when
 *  the ryo rate is off, so WAR_RYO_PER_WR=0 restores the WR-only price. */
export function preparationBoneCharmsForWr(wrCharged: number, ryoPerWr: number = RYO_PER_WR): number {
    const rate = Number(ryoPerWr);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    return Math.round(wholeNonNegative(wrCharged) * PREP_BONE_CHARMS_PER_WR);
}
