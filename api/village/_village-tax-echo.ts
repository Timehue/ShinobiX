import type { VillageTaxResult } from '../_war-tax-apply.js';

/**
 * What a daily-claim route echoes of the occupation tax it assessed
 * (2026-10 rebalance, I-11). The tax writes the save whenever it stamps a day,
 * even an untaxed one, so the echo rides every response whose assessment wrote:
 * the client adopts `ryo` / `bankRyo` the way it adopts /api/village/tax's
 * reply (lib/village-tax-api.ts). Absent when the assessment wrote nothing.
 */
export function villageTaxEcho(result: VillageTaxResult): { villageTax: Record<string, unknown> } | Record<string, never> {
    if (!result._saveVersion && !result.applied) return {};
    return {
        villageTax: {
            applied: result.applied,
            taxed: result.taxed,
            toBurn: result.toBurn,
            toTreasury: result.toTreasury,
            ryo: result.ryo,
            bankRyo: result.bankRyo,
            ...(result._saveVersion ? { _saveVersion: result._saveVersion } : {}),
        },
    };
}
