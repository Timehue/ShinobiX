/*
 * Headless balance harness for the NEW continuous duel engine (pet-duel-sim.ts,
 * runPetDuel) — the engine being promoted to authoritative for PvE
 * (docs/pet-combat-redesign-plan.md, Phase D). Claude can't playtest, so this
 * gives hard numbers to tune the sim's INTERPRETATION of the existing pet stats
 * (no persisted field changes) until outcomes are sane.
 *
 * Run:  node --import tsx scripts/pet-duel-balance.ts
 *
 * Reports, over a representative rare-tier roster across many seeds:
 *   1. POSITION FAIRNESS — mirror matches (a pet vs an identical clone). The
 *      player-side win rate MUST be ≈50%; the blue/red spawn must not advantage
 *      a side or every PvE fight is rigged. This is the #1 gate.
 *   2. ROLE matrix + overall — each role ≈50% vs the field (40–60% healthy).
 *   3. ELEMENT matrix + overall — each element ≈50% (the type chart adds signal).
 *   4. MATCH LENGTH — avg/median seconds + % hitting the 30s cap (a high cap rate
 *      means the sim is too passive / damage too low → timeout draws).
 *   5. ULTIMATE USAGE — % of matches where a signature/ultimate fires (should be
 *      a real fraction; ~0% means ultimates never charge — a feel bug).
 *   6. PER-PET OUTLIERS — strongest / weakest pets by position-neutral win rate.
 */
import { runPetDuel, DUEL_TPS } from "../shinobij.client/src/lib/pet-duel-sim";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import { derivePetRole, type PetRole } from "../shinobij.client/src/lib/pet-roles";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import type { Pet } from "../shinobij.client/src/types/pet";

const SEEDS = Array.from({ length: 8 }, (_, i) => i * 131 + 11);
const ROLES: PetRole[] = ["defender", "tracker", "assassin", "sage"];
const ELEMENTS = ["Fire", "Water", "Wind", "Lightning", "Earth"];
const CAP_TICKS = DUEL_TPS * 30; // the engine's 30s hard cap

const pool = rawPetPool.map(balanceBuiltInPetTemplate).filter((p) => p.rarity === "rare");
const roleOf = (p: Pet): PetRole => derivePetRole(p).role;
const elOf = (p: Pet): string => p.element ?? "None";

// Whole rare tier as the roster — large enough that per-role / per-element
// win-rates aren't dominated by a single pet's stats (the earlier 2-per-element
// sample was too noisy to trust the role/element breakdowns).
const roster = pool;

type Tally = { win: number; n: number };
const add = (t: Tally, w: number) => { t.win += w; t.n += 1; };
const pct = (t: Tally) => t.n ? (t.win / t.n) * 100 : 0;
const fresh = (): Tally => ({ win: 0, n: 0 });
const wOf = (res: string) => (res === "win" ? 1 : res === "draw" ? 0.5 : 0);

// ── 1. Position fairness (mirror: pet vs identical clone) ────────────────────
const mirror = fresh();
for (const p of roster) for (const seed of SEEDS) add(mirror, wOf(runPetDuel(p, p, seed).result));

// ── 2–6. Round-robin, BOTH orderings (so per-pet/role/element are position-neutral) ──
const roleM: Record<string, Record<string, Tally>> = {};
const elM: Record<string, Record<string, Tally>> = {};
const perPet = new Map<string, { name: string; t: Tally }>();
const playerSide = fresh();
let ticksSum = 0, matches = 0, capHits = 0, ultMatches = 0;
let hitSum = 0, dmgSum = 0, whiffSum = 0, dodgeSum = 0;
const ticksAll: number[] = [];
for (const a of ROLES) { roleM[a] = {}; for (const b of ROLES) roleM[a][b] = fresh(); }
for (const a of ELEMENTS) { elM[a] = {}; for (const b of ELEMENTS) elM[a][b] = fresh(); }
for (const p of roster) perPet.set(p.id, { name: p.name, t: fresh() });
// Per-role behavior diagnostic (as the player team): how much damage the role
// deals, how many support casts it spends, and how often its fights hit the cap.
const roleDiag: Record<string, { dmg: number; support: number; cap: number; n: number }> = {};
for (const a of ROLES) roleDiag[a] = { dmg: 0, support: 0, cap: 0, n: 0 };

for (const pa of roster) for (const pb of roster) {
    if (pa.id === pb.id) continue;
    for (const seed of SEEDS) {
        const r = runPetDuel(pa, pb, seed);
        const w = wOf(r.result);
        add(playerSide, w);
        matches++; ticksSum += r.ticks; ticksAll.push(r.ticks);
        if (r.ticks >= CAP_TICKS) capHits++;
        if (r.events.some((e) => e.type === "ultimate")) ultMatches++;
        for (const e of r.events) {
            if (e.type === "hit") { hitSum++; dmgSum += e.dmg ?? 0; }
            else if (e.type === "whiff") whiffSum++;
            else if (e.type === "dodge") dodgeSum++;
        }
        // pa as player gets w; pb (as enemy) gets the inverse — position-neutral.
        add(perPet.get(pa.id)!.t, w);
        add(perPet.get(pb.id)!.t, 1 - w);
        if (roleM[roleOf(pa)]?.[roleOf(pb)]) add(roleM[roleOf(pa)][roleOf(pb)], w);
        if (elM[elOf(pa)]?.[elOf(pb)]) add(elM[elOf(pa)][elOf(pb)], w);
        const rd = roleDiag[roleOf(pa)];
        rd.n++;
        if (r.ticks >= CAP_TICKS) rd.cap++;
        for (const e of r.events) {
            if (e.side !== "player") continue;
            if (e.type === "hit") rd.dmg += e.dmg ?? 0;
            else if (e.type === "heal" || e.type === "shield" || e.type === "buff") rd.support++;
        }
    }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const sec = (ticks: number) => (ticks / DUEL_TPS).toFixed(1);

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
console.log(`pet-duel-balance — rare tier, roster ${roster.length}, ${SEEDS.length} seeds, ${matches} matches`);
console.log(`   roster avg — hp ${avg(roster.map((p) => p.hp || 0)).toFixed(0)}  atk ${avg(roster.map((p) => p.attack || 0)).toFixed(0)}  def ${avg(roster.map((p) => p.defense || 0)).toFixed(0)}  spd ${avg(roster.map((p) => p.speed || 0)).toFixed(0)}\n`);

console.log("1. POSITION FAIRNESS (mirror, player-side win rate — want ≈50%)");
console.log(`   mirror player win:  ${pct(mirror).toFixed(1)}%   (${mirror.n} matches)`);
console.log(`   round-robin player win:  ${pct(playerSide).toFixed(1)}%   (any skew here = spawn bias)\n`);

console.log("2. ROLE matrix (row = player role, cell = player win %)");
console.log("vs".padEnd(11) + ROLES.map((r) => r.slice(0, 8).padStart(9)).join(""));
for (const a of ROLES) console.log(a.padEnd(11) + ROLES.map((b) => `${pct(roleM[a][b]).toFixed(0)}%`.padStart(9)).join(""));
console.log("   overall (vs field):");
for (const a of ROLES) {
    const t = fresh(); for (const b of ROLES) if (a !== b) { t.win += roleM[a][b].win; t.n += roleM[a][b].n; }
    console.log(`     ${a.padEnd(10)} ${pct(t).toFixed(1)}%`);
}

console.log("\n3. ELEMENT overall win rate (vs field — want ≈50% each)");
for (const a of ELEMENTS) {
    const t = fresh(); for (const b of ELEMENTS) if (a !== b) { t.win += elM[a][b].win; t.n += elM[a][b].n; }
    console.log(`     ${a.padEnd(10)} ${pct(t).toFixed(1)}%`);
}

console.log("\n4. MATCH LENGTH");
console.log(`     avg ${sec(ticksSum / Math.max(1, matches))}s   median ${sec(median(ticksAll))}s   cap(30s) hits ${((capHits / Math.max(1, matches)) * 100).toFixed(1)}%`);
console.log(`     per match — hits ${(hitSum / Math.max(1, matches)).toFixed(1)}  dmg ${(dmgSum / Math.max(1, matches)).toFixed(0)}  whiffs ${(whiffSum / Math.max(1, matches)).toFixed(1)}  dodges ${(dodgeSum / Math.max(1, matches)).toFixed(1)}`);

console.log("\n5. ULTIMATE USAGE");
console.log(`     matches with an ultimate: ${((ultMatches / Math.max(1, matches)) * 100).toFixed(1)}%`);

console.log("\n7. PER-ROLE DIAGNOSTIC (as player team)");
for (const a of ROLES) {
    const d = roleDiag[a];
    console.log(`     ${a.padEnd(10)} dmg/match ${(d.dmg / Math.max(1, d.n)).toFixed(0)}  support-casts/match ${(d.support / Math.max(1, d.n)).toFixed(1)}  cap ${((d.cap / Math.max(1, d.n)) * 100).toFixed(0)}%`);
}

console.log("\n6. PER-PET OUTLIERS (position-neutral win rate)");
const ranked = [...perPet.values()].sort((a, b) => pct(b.t) - pct(a.t));
const fmt = (e: { name: string; t: Tally }) => `${String(e.name ?? "?").padEnd(18)} ${pct(e.t).toFixed(1)}%`;
console.log("   strongest:");
for (const e of ranked.slice(0, 4)) console.log(`     ${fmt(e)}`);
console.log("   weakest:");
for (const e of ranked.slice(-4)) console.log(`     ${fmt(e)}`);
