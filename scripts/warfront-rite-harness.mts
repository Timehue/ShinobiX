/*
 * Hollow Warfront (the Rite) balance harness.
 *
 * The mode fields four pets a side on a deterministic formation grid, best of
 * three clashes, so
 * the numbers that decide whether it is shippable are:
 *
 *   MIRROR FAIRNESS  — does the blue seat win more with identical bands?
 *   PACING           — does a clash resolve, or does it grind into the engine's
 *                      75s cap with half the board still standing?
 *   TACTICAL PLAY    — do range, terrain, support and shadow-step actions fire,
 *                      or does the board collapse into undifferentiated melee?
 *   COMEBACKS        — does losing the first clash end the match? A best-of-three
 *                      whose second clash is a formality is a one-clash mode
 *                      wearing a three-clash costume.
 *   FORMATION        — does WHICH pet holds the front line change anything? If
 *                      not, the mode's only tactical decision is decoration.
 *
 *   node --import tsx scripts/warfront-rite-harness.mts [matches]
 */
import {
    RITE_ACTIVE_SIZE,
    RITE_BAND_SIZE,
    RITE_SQUAD_HP_SCALE,
    runWarfrontRite,
    type RitePlan,
} from "../shinobij.client/src/lib/pet-warfront-rite.ts";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance.ts";
import { derivePetRole } from "../shinobij.client/src/lib/pet-roles.ts";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool.ts";
import type { Pet } from "../shinobij.client/src/types/pet.ts";

const MATCHES = Math.max(8, Number(process.argv[2] ?? 40) | 0);

/** REAL pool pets, balanced exactly as the game balances them. Synthetic
 *  fixtures lie about pacing: a hand-written stat block has a different
 *  HP-to-damage ratio than a shipped pet, and pacing is the whole question. */
const POOL: Pet[] = rawPetPool
    .filter((pet) => pet.rarity !== "mythic")
    .map((pet) => balanceBuiltInPetTemplate(pet));

const roleOf = (pet: Pet) => String(pet.role ?? derivePetRole(pet).role);

/** Four distinct pool pets, drawn from the real balanced pool. */
const band = (seed: number, tag: string): Pet[] => {
    const picked: Pet[] = [];
    for (let i = 0; picked.length < RITE_BAND_SIZE && i < POOL.length * 2; i++) {
        const pet = POOL[(seed * 31 + i * 17) % POOL.length];
        if (!picked.some((p) => p.id === pet.id)) picked.push(pet);
    }
    return picked.map((pet, i) => ({ ...pet, id: `${tag}-${pet.id}-${i}` }));
};

const plan = (formation: number[], deployment?: number[]): RitePlan => ({ formation, deployment, reformAfterClash: null, reform: null, reformDeployment: null });
const pct = (n: number, d: number) => (d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`);
const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))] ?? 0;
};

console.log(`\nHollow Warfront · Kage Tactics harness — ${MATCHES} matches, 4v4 formation combat, hp scale ${RITE_SQUAD_HP_SCALE}, pool ${POOL.length}\n`);

// ── 1. Mirror fairness, pacing and participation ────────────────────────────
const matchLens: number[] = [];
const clashLens: number[] = [];
const clashCounts: number[] = [];
let blueWins = 0;
let draws = 0;
let sweeps = 0;
let comebacks = 0;
let cappedClashes = 0;
const cappedContexts: string[] = [];
let totalClashes = 0;
let idleFighters = 0;
let totalFighters = 0;
let preKoScrums = 0;
let maxPreKoKnot = 0;
let maxPreKoContext = "";
let coordinatedOpenings = 0;
let maxPlantedTicks = 0;
let maxPlantedContext = "";
let rangedClashes = 0;
let supportClashes = 0;
let shadowStepClashes = 0;

for (let seed = 1; seed <= MATCHES; seed++) {
    const roster = band(seed, "m");
    const mirrorPlan = plan([0, 1, 2, 3]);
    const result = runWarfrontRite(
        roster,
        roster.map((p) => ({ ...p, id: `r${p.id}` })),
        seed,
        mirrorPlan,
        mirrorPlan,
    );
    if (result.winner === "blue") blueWins++;
    if (result.winner === null) draws++;
    matchLens.push(result.totalSeconds);
    clashCounts.push(result.clashes.length);
    if (result.blueRounds === 0 || result.redRounds === 0) sweeps++;
    const firstLoser = result.clashes[0].winner === "blue" ? "red" : "blue";
    if (result.winner === firstLoser) comebacks++;

    for (let clashIndex = 0; clashIndex < result.clashes.length; clashIndex++) {
        const clash = result.clashes[clashIndex];
        totalClashes++;
        clashLens.push(clash.seconds);
        if (clash.result.snapshots.some((snapshot) => snapshot.projectiles.length > 0)) rangedClashes++;
        if (clash.result.events.some((event) => event.type === "heal" || event.type === "shield" || event.type === "buff")) supportClashes++;
        if (clash.result.events.some((event) => event.type === "maneuver" && event.move === "SHADOW STEP")) shadowStepClashes++;
        if (clash.seconds >= 37.9) {
            cappedClashes++;
            const ending = clash.result.snapshots[clash.result.snapshots.length - 1];
            const survivors = ending.actors
                .filter((actor) => actor.hp > 0)
                .map((actor) => `${actor.id}:${Math.round((actor.hp / actor.maxHp) * 100)}%`)
                .join(",");
            const rosterRead = roster.slice(0, RITE_ACTIVE_SIZE)
                .map((pet, slot) => `${slot}:${pet.name}/${roleOf(pet)}`)
                .join(",");
            const hits = clash.result.events.filter((event) => event.type === "hit");
            const heals = clash.result.events.filter((event) => event.type === "heal");
            cappedContexts.push(`seed ${seed} clash ${clashIndex + 1} [${survivors}] {${rosterRead}} hits:${hits.length}/last:${hits[hits.length - 1]?.t ?? "-"} heals:${heals.length}`);
        }
        const ordered = clash.result.snapshots.find((snapshot) => snapshot.actors.every((actor) => actor.hp <= 0 || Boolean(actor.targetId)));
        if (ordered && (["player", "enemy"] as const).every((team) => {
            const counts = new Map<string, number>();
            for (const actor of ordered.actors) if (actor.team === team && actor.hp > 0 && actor.targetId) {
                counts.set(actor.targetId, (counts.get(actor.targetId) ?? 0) + 1);
            }
            return Math.max(0, ...counts.values()) <= 2;
        })) coordinatedOpenings++;
        const previous = new Map<string, { x: number; y: number }>();
        const planted = new Map<string, number>();
        for (const snapshot of clash.result.snapshots) {
            for (const actor of snapshot.actors) {
                const prior = previous.get(actor.id);
                const still = actor.hp > 0 && actor.state === "idle" && prior
                    && Math.hypot(actor.x - prior.x, actor.y - prior.y) < 0.012;
                const ticks = still ? (planted.get(actor.id) ?? 0) + 1 : 0;
                planted.set(actor.id, ticks);
                if (ticks > maxPlantedTicks) {
                    maxPlantedTicks = ticks;
                    const target = snapshot.actors.find((candidate) => candidate.id === actor.targetId);
                    maxPlantedContext = `seed ${seed} clash ${clashIndex + 1} t${snapshot.t} · ${actor.id} @ ${actor.x.toFixed(1)},${actor.y.toFixed(1)} → ${actor.targetId ?? "none"} (${target?.hp && target.hp > 0 ? "live" : "down"}) [${actor.statuses.join(",") || "clear"}]`;
                }
                previous.set(actor.id, { x: actor.x, y: actor.y });
            }
        }
        const firstKoTick = clash.result.events.find((event) => event.type === "ko")?.t ?? Infinity;
        let clashKnot = 0;
        for (let index = 0; index < clash.result.snapshots.length; index += 4) {
            const snapshot = clash.result.snapshots[index];
            if (snapshot.t >= firstKoTick) break;
            const living = snapshot.actors.filter((actor) => actor.hp > 0);
            for (const actor of living) {
                const neighbors = living.filter((other) => Math.hypot(other.x - actor.x, other.y - actor.y) <= 3.65);
                clashKnot = Math.max(clashKnot, neighbors.length);
                if (neighbors.length > maxPreKoKnot) {
                    maxPreKoKnot = neighbors.length;
                    maxPreKoContext = `seed ${seed} clash ${clashIndex + 1} t${snapshot.t} · ${neighbors.map((other) => `${other.id}@${other.x.toFixed(1)},${other.y.toFixed(1)}→${other.targetId ?? "?"}`).join(" | ")}`;
                }
            }
        }
        maxPreKoKnot = Math.max(maxPreKoKnot, clashKnot);
        if (clashKnot > 3) preKoScrums++;
        // An actor that neither lands nor takes a hit is standing around — the
        // first symptom of a 1v1-tuned AI failing at squad scale.
        const acted = new Set<string>();
        for (const e of clash.result.events) {
            if (e.actorId) acted.add(e.actorId);
            if (e.targetId) acted.add(e.targetId);
        }
        for (const c of [...clash.blue, ...clash.red]) {
            totalFighters++;
            const side = clash.blue.includes(c) ? "player" : "enemy";
            if (!acted.has(`${side}-${c.lane}`)) idleFighters++;
        }
    }
}

console.log("MIRROR · PACING · TACTICAL PLAY (identical bands both seats)");
console.log(`  blue decisive win rate  ${pct(blueWins, MATCHES - draws)}   (fair band 42–58%)`);
console.log(`  drawn matches           ${pct(draws, MATCHES)}`);
console.log(`  match combat time       median ${q(matchLens, 0.5).toFixed(1)}s · p90 ${q(matchLens, 0.9).toFixed(1)}s`);
console.log(`  single clash            median ${q(clashLens, 0.5).toFixed(1)}s · p90 ${q(clashLens, 0.9).toFixed(1)}s`);
console.log(`  clashes per match       median ${q(clashCounts, 0.5)} · range ${Math.min(...clashCounts)}–${Math.max(...clashCounts)}`);
console.log(`  clashes hitting the cap ${pct(cappedClashes, totalClashes)}   (want low — a capped clash is a stall)`);
if (cappedContexts.length) console.log(`                           ${cappedContexts.slice(0, 8).join(" · ")}`);
console.log(`  IDLE fighters           ${pct(idleFighters, totalFighters)}   (want ~0% — an idle pet is the AI failing at squad scale)`);
console.log(`  clashes with projectiles ${pct(rangedClashes, totalClashes)}   (range must stay visible)`);
console.log(`  clashes with protection ${pct(supportClashes, totalClashes)}   (support must affect allies)`);
console.log(`  clashes with shadow step ${pct(shadowStepClashes, totalClashes)}   (assassins must threaten the back line)`);
console.log(`  longest planted pause   ${(maxPlantedTicks / 30).toFixed(2)}s   (cooldown read, not a deadlock)`);
console.log(`                           ${maxPlantedContext}`);
console.log(`  split-target openings   ${pct(coordinatedOpenings, totalClashes)}   (want 100% — no four-pet dogpile)`);
console.log(`  pre-KO 4+ adjacent knot ${pct(preKoScrums, totalClashes)}   (informational; hard cell ownership still prevents overlap; maximum ${maxPreKoKnot})`);
if (maxPreKoKnot > 3) console.log(`                           ${maxPreKoContext}`);
console.log(`  2–0 sweeps              ${pct(sweeps, MATCHES)}`);
console.log(`  first-clash loser wins  ${pct(comebacks, MATCHES)}   (baseline without re-form; the player's one re-form is the comeback lever)`);

// ── 2. Does formation change anything? ──────────────────────────────────────
// Same four pets, same opponent, same seed — only their cells change.
let tanksForwardWins = 0;
let squishForwardWins = 0;
let formationChanged = 0;
let formationValid = 0;

for (let seed = 1; seed <= MATCHES; seed++) {
    const mine = band(seed, "f");
    const theirs = band(seed, "g");
    const durable = [...mine.keys()].sort((a, b) => {
        const score = (i: number) => (mine[i].hp ?? 0) + (mine[i].defense ?? 0) * 4 + (roleOf(mine[i]) === "defender" ? 900 : 0);
        return score(b) - score(a);
    });
    const rosterOrder = [0, 1, 2, 3];
    const nodesByPriority = [5, 3, 4, 6];
    const deploymentFor = (priority: number[]) => {
        const deployed = Array<number>(RITE_ACTIVE_SIZE);
        priority.forEach((slot, index) => { deployed[slot] = nodesByPriority[index]; });
        return deployed;
    };
    const tanksForward = deploymentFor(durable);
    const squishForward = deploymentFor([...durable].reverse());
    if (tanksForward.join() === squishForward.join()) continue;
    formationValid++;
    const a = runWarfrontRite(mine, theirs, seed, plan(rosterOrder, tanksForward));
    const b = runWarfrontRite(mine, theirs, seed, plan(rosterOrder, squishForward));
    if (a.winner === "blue") tanksForwardWins++;
    if (b.winner === "blue") squishForwardWins++;
    if (a.winner !== b.winner) formationChanged++;
}

console.log("\nDEPLOYMENT (same band and rival; only pet placement changes)");
console.log(`  durable pets forward    ${pct(tanksForwardWins, formationValid)} wins`);
console.log(`  fragile pets forward    ${pct(squishForwardWins, formationValid)} wins`);
console.log(`  outcome CHANGED         ${pct(formationChanged, formationValid)}   (if ~0%, the tactics are decoration)`);

// ── 3. Does the better band actually win? ───────────────────────────────────
let strongWins = 0;
for (let seed = 1; seed <= MATCHES; seed++) {
    const strong = band(seed, "s").map((p) => ({ ...p, hp: Math.round(p.hp * 1.25), attack: Math.round(p.attack * 1.2) }));
    const equalPlan = plan([0, 1, 2, 3]);
    if (runWarfrontRite(strong, band(seed, "w"), seed, equalPlan, equalPlan).winner === "blue") strongWins++;
}
console.log("\nPOWER CHECK (+25% hp / +20% attack)");
console.log(`  stronger band wins      ${pct(strongWins, MATCHES)}   (want 90%+ at this very large combined stat advantage)`);
console.log("");
