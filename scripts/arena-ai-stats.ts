/*
 * Headless behavioural-stats harness for the tactical pet-arena AI.
 * Claude is blind to the live 3D scene, so this gives hard numbers to compare
 * AI revisions (R1 team-blackboard, R2 utility core, …) against a baseline.
 *
 * Run:  node --import tsx scripts/arena-ai-stats.ts
 *
 * Metrics per config (averaged over seeds):
 *   • len   — match length in seconds
 *   • caps  — scroll captures per match (both teams)
 *   • kills — defeats per match (both teams)
 *   • focus — avg ticks a pet spends below 30% HP before it dies
 *             (lower = the team COLLAPSES on a wounded target faster)
 *   • carry — avg ticks a carrier holds the scroll before capture/drop/death
 *             (lower for the defending side = peels are landing)
 *   • draws — share of matches that hit the time cap / tiebreaker
 */
import { runPetArenaMatch, ARENA_TPS, type ArenaSlot, type ArenaRole } from "../shinobij.client/src/lib/pet-arena-sim";
import type { Pet } from "../shinobij.client/src/types/pet";

function mkPet(over: Partial<Pet> = {}): Pet {
    return { id: "p", name: "T", rarity: "rare", level: 25, xp: 0, maxLevel: 50, hp: 700, attack: 90, defense: 40, speed: 70, unlockedForPve: true, element: "Fire", trait: "Aggressive", moveRange: 2, jutsus: [], ...over } as Pet;
}
function roster(roles: ArenaRole[], over: Partial<Pet> = {}): ArenaSlot[] {
    return roles.map((role, i) => ({ pet: mkPet({ id: `${role}-${i}`, ...over }), role }));
}

const COMP: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 101 + 1);

interface Agg { len: number; caps: number; kills: number; focusSum: number; focusN: number; carrySum: number; carryN: number; draws: number; bWin: number; bLives: number; rLives: number; n: number; }
const blank = (): Agg => ({ len: 0, caps: 0, kills: 0, focusSum: 0, focusN: 0, carrySum: 0, carryN: 0, draws: 0, bWin: 0, bLives: 0, rLives: 0, n: 0 });

function analyze(agg: Agg, r: ReturnType<typeof runPetArenaMatch>) {
    agg.n++;
    agg.len += r.ticks / ARENA_TPS;
    agg.caps += r.events.filter((e) => e.type === "capture").length;
    const kills = r.events.filter((e) => e.type === "kill") as Array<{ t: number; targetId: string }>;
    agg.kills += kills.length;
    if (r.winner === "draw" || r.ticks >= ARENA_TPS * 300) agg.draws++;
    if (r.winner === "blue") agg.bWin++;
    const last = r.snapshots[r.snapshots.length - 1];
    for (const a of last.actors) { if (a.team === "blue") agg.bLives += Math.max(0, a.lives); else agg.rLives += Math.max(0, a.lives); }

    // focus-collapse: ticks each killed pet spent below 30% HP before dying
    for (const k of kills) {
        const id = k.targetId; let below = -1;
        for (let t = k.t; t >= 0; t--) {
            const a = r.snapshots[t]?.actors.find((x) => x.id === id);
            if (!a) break;
            if (a.hp <= a.maxHp * 0.30) below = t; else break;
        }
        if (below >= 0) { agg.focusSum += k.t - below; agg.focusN++; }
    }
    // carrier hold time: pickup → next capture/drop for that actor
    const picks = r.events.filter((e) => e.type === "pickup") as Array<{ t: number; actorId?: string }>;
    for (const p of picks) {
        const end = r.events.find((e) => e.t >= p.t && (e.type === "capture" || e.type === "drop"));
        if (end) { agg.carrySum += end.t - p.t; agg.carryN++; }
    }
}

function row(label: string, a: Agg): string {
    const f = (n: number, d = 1) => n.toFixed(d).padStart(6);
    return `${label.padEnd(22)} len=${f(a.len / a.n)}s  caps=${f(a.caps / a.n)}  kills=${f(a.kills / a.n)}  ` +
        `focus=${f(a.focusN ? a.focusSum / a.focusN : 0)}t  carry=${f(a.carryN ? a.carrySum / a.carryN : 0)}t  ` +
        `draws=${f(100 * a.draws / a.n, 0)}%  bWin=${f(100 * a.bWin / a.n, 0)}%  bLives=${f(a.bLives / a.n)}  rLives=${f(a.rLives / a.n)}`;
}

const configs: Array<{ label: string; blue: ArenaSlot[]; red: ArenaSlot[] }> = [
    { label: "4v4 mirror", blue: roster(COMP), red: roster(COMP) },
    { label: "4v4 slight edge", blue: roster(COMP, { attack: 110 }), red: roster(COMP) },
    { label: "2v2 def+sage", blue: roster(["defender", "sage"]), red: roster(["tracker", "assassin"]) },
    { label: "4v4 double-assassin", blue: roster(["assassin", "assassin", "tracker", "sage"]), red: roster(COMP) },
];

console.log(`arena-ai-stats — ${SEEDS.length} seeds/config\n`);
for (const c of configs) {
    const agg = blank();
    for (const seed of SEEDS) analyze(agg, runPetArenaMatch(c.blue, c.red, seed));
    console.log(row(c.label, agg));
}
