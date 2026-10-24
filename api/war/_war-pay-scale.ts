/*
 * The staged war pay raise (2026-10 rebalance, framework #7 / #31 / #32; owner
 * answers A8 and A13).
 *
 * One dial scales every raised war payout together: the village and sector war
 * purses (ryo and purse honor), the MVP ryo above 10,000 and the ANBU vault-raid
 * ryo above 500. Owner amendment A13: full pay at launch, so the code default is
 * 1 and the env var is only an emergency off/down switch. 0 restores the old pay
 * exactly: no purse, 10,000 MVP ryo, 500 per raid.
 *
 * Pure and import-light (no storage), so the IO-free reward cores can read it.
 */

import { economyDial } from '../_economy-dials.js';

export const WAR_PURSE_SCALE_DEFAULT = 1;

/** WAR_PURSE_SCALE (default 1, range 0-1). */
export function warPurseScale(): number {
    return economyDial('WAR_PURSE_SCALE', WAR_PURSE_SCALE_DEFAULT, { min: 0, max: 1 });
}

/** The staged raise: the old value plus `scale` of the way to the full value. */
export function stagedRaise(today: number, full: number, scale: number): number {
    const s = Math.max(0, Math.min(1, Number(scale) || 0));
    return today + Math.round(s * Math.max(0, full - today));
}
