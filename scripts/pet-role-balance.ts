/*
 * Headless role-balance harness for the LIVE 1v1 pet battle engine
 * (runPetArenaBattle). Validates that the native-role base-stat LEAN doesn't make
 * any role dominate — Claude can't playtest, so this gives hard win-rate numbers.
 *
 * Run:  node --import tsx scripts/pet-role-balance.ts
 *
 * For every ordered role pair (A vs B) it runs a representative set of real pool
 * pets of each role across many seeds and reports A's win rate. A balanced system:
 *   • each role's OVERALL win rate ≈ 50%
 *   • no single pair wildly lopsided beyond element/rng noise (~40–60%).
 * Element type-advantage (Fire>Wind>…) adds real noise, so reps span elements.
 */
import { runPetArenaBattle } from "../shinobij.client/src/lib/pet-battle-sim";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import { derivePetRole, type PetRole } from "../shinobij.client/src/lib/pet-roles";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import type { Pet } from "../shinobij.client/src/types/pet";

const ROLES: PetRole[] = ["defender", "tracker", "assassin", "sage"];
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 137 + 7);
const REPS = 3; // representative pets per role (spanning elements)

const pool = rawPetPool.map(balanceBuiltInPetTemplate).filter((p) => p.rarity === "rare");
// Pick REPS pets per role, spreading across elements to average out type advantage.
function repsFor(role: PetRole): Pet[] {
    const of = pool.filter((p) => derivePetRole(p).role === role);
    const byEl = new Map<string, Pet>();
    for (const p of of) if (!byEl.has(p.element ?? "None")) byEl.set(p.element ?? "None", p);
    const spread = [...byEl.values()];
    return (spread.length >= REPS ? spread : of).slice(0, REPS);
}
const reps: Record<PetRole, Pet[]> = { defender: repsFor("defender"), tracker: repsFor("tracker"), assassin: repsFor("assassin"), sage: repsFor("sage") };

// A vs B: fraction of battles A wins (draws count 0.5), averaged over reps × seeds.
function winRate(a: PetRole, b: PetRole): number {
    let aw = 0, n = 0;
    for (const pa of reps[a]) for (const pb of reps[b]) for (const seed of SEEDS) {
        const r = runPetArenaBattle(pa, pb, "AI", seed) as { result?: string };
        aw += r.result === "win" ? 1 : r.result === "draw" ? 0.5 : 0;
        n++;
    }
    return aw / Math.max(1, n);
}

console.log(`pet-role-balance — rare tier, ${REPS} reps/role, ${SEEDS.length} seeds\n`);
const matrix: Record<PetRole, Record<PetRole, number>> = {} as never;
for (const a of ROLES) { matrix[a] = {} as never; for (const b of ROLES) matrix[a][b] = a === b ? 0.5 : winRate(a, b); }

const hdr = "vs".padEnd(10) + ROLES.map((r) => r.slice(0, 8).padStart(9)).join("");
console.log(hdr);
for (const a of ROLES) {
    console.log(a.padEnd(10) + ROLES.map((b) => `${(matrix[a][b] * 100).toFixed(0)}%`.padStart(9)).join(""));
}
console.log("\noverall win rate (vs the other 3 roles):");
for (const a of ROLES) {
    const others = ROLES.filter((b) => b !== a);
    const avg = others.reduce((s, b) => s + matrix[a][b], 0) / others.length;
    console.log(`  ${a.padEnd(10)} ${(avg * 100).toFixed(1)}%`);
}
