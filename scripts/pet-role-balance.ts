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
 *
 * The computation is exposed as the pure `roleBalanceReport()` so the colocated
 * `pet-role-balance.test.ts` can assert win-rate BANDS (a balance ratchet, like
 * App.size.test.ts) without re-implementing the sim. The console output below is
 * a thin main() wrapper, kept identical to the previous script behaviour.
 */
import { runPetArenaBattle } from "../shinobij.client/src/lib/pet-battle-sim";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import { derivePetRole, type PetRole } from "../shinobij.client/src/lib/pet-roles";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import type { Pet } from "../shinobij.client/src/types/pet";

export const ROLES: PetRole[] = ["defender", "tracker", "assassin", "sage"];
const DEFAULT_SEEDS = Array.from({ length: 24 }, (_, i) => i * 137 + 7);
const DEFAULT_REPS = 3; // representative pets per role (spanning elements)

const pool = rawPetPool.map(balanceBuiltInPetTemplate).filter((p) => p.rarity === "rare");
// Pick `repCount` pets per role, spreading across elements to average out type advantage.
function repsFor(role: PetRole, repCount: number): Pet[] {
    const of = pool.filter((p) => derivePetRole(p).role === role);
    const byEl = new Map<string, Pet>();
    for (const p of of) if (!byEl.has(p.element ?? "None")) byEl.set(p.element ?? "None", p);
    const spread = [...byEl.values()];
    return (spread.length >= repCount ? spread : of).slice(0, repCount);
}

export interface RoleBalanceReport {
    /** matrix[a][b] = fraction of battles role A wins vs role B (diagonal = 0.5). */
    matrix: Record<PetRole, Record<PetRole, number>>;
    /** overall[a] = role A's average win rate vs the OTHER three roles. */
    overall: Record<PetRole, number>;
    seeds: number;
    reps: number;
}

// Deterministic (fixed seeds) — same inputs always produce the same report, so a
// test can assert exact bands. Pass a smaller {seeds, reps} for a faster CI run.
export function roleBalanceReport(opts: { seeds?: number[]; reps?: number } = {}): RoleBalanceReport {
    const seeds = opts.seeds ?? DEFAULT_SEEDS;
    const repCount = opts.reps ?? DEFAULT_REPS;
    const reps: Record<PetRole, Pet[]> = {
        defender: repsFor("defender", repCount),
        tracker: repsFor("tracker", repCount),
        assassin: repsFor("assassin", repCount),
        sage: repsFor("sage", repCount),
    };

    // A vs B: fraction of battles A wins (draws count 0.5), averaged over reps × seeds.
    function winRate(a: PetRole, b: PetRole): number {
        let aw = 0, n = 0;
        for (const pa of reps[a]) for (const pb of reps[b]) for (const seed of seeds) {
            const r = runPetArenaBattle(pa, pb, "AI", seed) as { result?: string };
            aw += r.result === "win" ? 1 : r.result === "draw" ? 0.5 : 0;
            n++;
        }
        return aw / Math.max(1, n);
    }

    const matrix = {} as Record<PetRole, Record<PetRole, number>>;
    for (const a of ROLES) { matrix[a] = {} as Record<PetRole, number>; for (const b of ROLES) matrix[a][b] = a === b ? 0.5 : winRate(a, b); }

    const overall = {} as Record<PetRole, number>;
    for (const a of ROLES) {
        const others = ROLES.filter((b) => b !== a);
        overall[a] = others.reduce((s, b) => s + matrix[a][b], 0) / others.length;
    }

    return { matrix, overall, seeds: seeds.length, reps: repCount };
}

function printReport(r: RoleBalanceReport): void {
    console.log(`pet-role-balance — rare tier, ${r.reps} reps/role, ${r.seeds} seeds\n`);
    const hdr = "vs".padEnd(10) + ROLES.map((role) => role.slice(0, 8).padStart(9)).join("");
    console.log(hdr);
    for (const a of ROLES) {
        console.log(a.padEnd(10) + ROLES.map((b) => `${(r.matrix[a][b] * 100).toFixed(0)}%`.padStart(9)).join(""));
    }
    console.log("\noverall win rate (vs the other 3 roles):");
    for (const a of ROLES) {
        console.log(`  ${a.padEnd(10)} ${(r.overall[a] * 100).toFixed(1)}%`);
    }
}

// Only print when run directly (node --import tsx scripts/pet-role-balance.ts),
// not when imported by the colocated band-assertion test. Windows-safe path check.
const isMain = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/pet-role-balance.ts");
if (isMain) printReport(roleBalanceReport());
