/*
 * The price of running from a road ambush.
 *
 * A hostile that catches you in a sector (a bandit, a night ninja, a contract
 * hunter, a war mercenary, the roaming Weekly Boss, or the ambush an
 * exploration turns up) stops you and makes you choose: fight, or flee.
 * Fleeing is never free, or every ambush would be a shrug. You run with half
 * the HP you had and drop part of your purse.
 *
 * Two limits keep it in proportion:
 *   - it never knocks you out, so the HP cost stops one point short of zero
 *     (a knockout is what sends a loser to the hospital);
 *   - the ryo you drop is capped at what the hospital charges at this level to
 *     skip its discharge timer (shared/hospital-discharge-cost.ts).
 * Banked ryo is never touched: only what you carry can be dropped.
 *
 * Shared by the server, which charges it (api/sector/road-flee.ts), and the
 * encounter dialog, which shows it before you choose.
 */
import { hospitalDischargeBaseCost } from './hospital-discharge-cost.js';

export const ROAD_FLEE_HP_SHARE = 0.5;
export const ROAD_FLEE_RYO_SHARE = 0.1;

export type RoadFleeCost = { hp: number; ryo: number };

function wholeNonNegative(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

export function roadFleeCost(hp: unknown, ryo: unknown, level: unknown): RoadFleeCost {
    const currentHp = wholeNonNegative(hp);
    const purse = wholeNonNegative(ryo);
    return {
        hp: Math.min(Math.floor(currentHp * ROAD_FLEE_HP_SHARE), Math.max(0, currentHp - 1)),
        ryo: Math.min(Math.floor(purse * ROAD_FLEE_RYO_SHARE), hospitalDischargeBaseCost(level)),
    };
}
