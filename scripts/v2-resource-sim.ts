/*
 * combatResourcesV2 resource-economy simulation.
 *
 * Validates the v2 pool / cost / regen / poison numbers against the design target
 * (~20 rounds of full-power aggression at low level → ~30 near cap) using the REAL
 * functions from api/_combat-resources.ts (no formula drift). Run:
 *   node --import tsx scripts/v2-resource-sim.ts
 */
import { v2JutsuResourceCost, v2ResourceRegen, v2PoisonOnSpend } from '../api/_combat-resources.js';

// v2 pool curve (mirrors lib/stats.ts / _xp-engine.ts v2PoolForLevel + constants).
const BASE = 1000, CAP = 10000, MAX_LEVEL = 100;
const pool = (L: number) => Math.min(CAP, Math.floor(BASE + (Math.max(1, L) - 1) * ((CAP - BASE) / (MAX_LEVEL - 1))));

// Simulate rounds of a rotation on ONE (primary-discipline) bar: regen at the start
// of each turn, then spend the rotation; stop when the full rotation is unaffordable.
function rounds(L: number, aps: number[]): number {
    let bar = pool(L);
    const regen = v2ResourceRegen(L);
    const spend = aps.reduce((s, ap) => s + v2JutsuResourceCost(ap, L), 0);
    let n = 0;
    while (n < 1000) {
        bar = Math.min(pool(L), bar + regen); // start-of-turn regen (turn 1 is a no-op at full)
        if (bar < spend) break;
        bar -= spend;
        n++;
    }
    return n;
}

const AGGRESSIVE = [60, 40]; // signature nuke + a utility, same bar
const MEASURED = [60];       // just the signature

console.log('LVL |  pool  | nuke util fkr | regen | aggressive | measured');
console.log('----+--------+---------------+-------+------------+---------');
for (const L of [1, 10, 25, 50, 75, 100]) {
    const row = [
        String(L).padStart(3),
        String(pool(L)).padStart(6),
        `${String(v2JutsuResourceCost(60, L)).padStart(4)} ${String(v2JutsuResourceCost(40, L)).padStart(4)} ${String(v2JutsuResourceCost(20, L)).padStart(3)}`,
        String(v2ResourceRegen(L)).padStart(5),
        String(rounds(L, AGGRESSIVE)).padStart(10),
        String(rounds(L, MEASURED)).padStart(8),
    ];
    console.log(row.join(' | '));
}

console.log('\nPoison-on-spend (HP damage per costed cast):');
console.log('LVL | 60-AP spend | 6% tag | 15% | 30% (bloodline)');
for (const L of [1, 25, 50, 75, 100]) {
    const spend = v2JutsuResourceCost(60, L);
    console.log(`${String(L).padStart(3)} | ${String(spend).padStart(11)} | ${String(v2PoisonOnSpend(spend, 6)).padStart(6)} | ${String(v2PoisonOnSpend(spend, 15)).padStart(3)} | ${v2PoisonOnSpend(spend, 30)}`);
}
console.log('\n(2-round poison ≈ 2× the per-cast number for a fighter casting once/round.)');
