/*
 * Hollow Warfront (the Rite) balance harness.
 *
 * The mode is four pets a side fighting AT ONCE, best of three clashes, so the
 * numbers that decide whether it is shippable are:
 *
 *   MIRROR FAIRNESS  — does the blue seat win more with identical bands?
 *   PACING           — does a clash resolve, or does it grind into the engine's
 *                      75s cap with half the board still standing?
 *   PARTICIPATION    — does every pet actually fight? The cinematic AI was tuned
 *                      for one or two fighters a side, so an idle actor is the
 *                      first way squad scale would fail.
 *   COMEBACKS        — does losing the first clash end the match? A best-of-three
 *                      whose second clash is a formality is a one-clash mode
 *                      wearing a three-clash costume.
 *   FORMATION        — does WHICH pet holds the front line change anything? If
 *                      not, the mode's only tactical decision is decoration.
 *
 *   node --import tsx scripts/warfront-rite-harness.mts [matches]
 */
import {
    RITE_BAND_SIZE,
    RITE_FRONT_SLOTS,
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

/** Four distinct pool pets, deterministically drawn from the seed. */
const band = (seed: number, tag: string): Pet[] => {
    const picked: Pet[] = [];
    for (let i = 0; picked.length < RITE_BAND_SIZE && i < POOL.length * 2; i++) {
        const pet = POOL[(seed * 31 + i * 17) % POOL.length];
        if (!picked.some((p) => p.id === pet.id)) picked.push(pet);
    }
    return picked.map((pet, i) => ({ ...pet, id: `${tag}-${pet.id}-${i}` }));
};

const plan = (formation: number[]): RitePlan => ({ formation, reformAfterClash: null, reform: null });
const pct = (n: number, d: number) => (d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`);
const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))] ?? 0;
};

console.log(`\nBeastbound Warfront harness — ${MATCHES} matches, 4v4 formation combat, hp scale ${RITE_SQUAD_HP_SCALE}, pool ${POOL.length}\n`);

// ── 1. Mirror fairness, pacing and participation ────────────────────────────
const matchLens: number[] = [];
const clashLens: number[] = [];
const clashCounts: number[] = [];
let blueWins = 0;
let draws = 0;
let sweeps = 0;
let comebacks = 0;
let cappedClashes = 0;
let totalClashes = 0;
let idleFighters = 0;
let totalFighters = 0;

for (let seed = 1; seed <= MATCHES; seed++) {
    const roster = band(seed, "m");
    const result = runWarfrontRite(roster, roster.map((p) => ({ ...p, id: `r${p.id}` })), seed);
    if (result.winner === "blue") blueWins++;
    if (result.winner === null) draws++;
    matchLens.push(result.totalSeconds);
    clashCounts.push(result.clashes.length);
    if (result.blueRounds === 0 || result.redRounds === 0) sweeps++;
    const firstLoser = result.clashes[0].winner === "blue" ? "red" : "blue";
    if (result.winner === firstLoser) comebacks++;

    for (const clash of result.clashes) {
        totalClashes++;
        clashLens.push(clash.seconds);
        if (clash.seconds >= 74) cappedClashes++;
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

console.log("MIRROR · PACING · PARTICIPATION (identical bands both seats)");
console.log(`  blue-seat win rate      ${pct(blueWins, MATCHES)}   (fair band 42–58%)`);
console.log(`  drawn matches           ${pct(draws, MATCHES)}`);
console.log(`  match combat time       median ${q(matchLens, 0.5).toFixed(1)}s · p90 ${q(matchLens, 0.9).toFixed(1)}s`);
console.log(`  single clash            median ${q(clashLens, 0.5).toFixed(1)}s · p90 ${q(clashLens, 0.9).toFixed(1)}s`);
console.log(`  clashes per match       median ${q(clashCounts, 0.5)} · range ${Math.min(...clashCounts)}–${Math.max(...clashCounts)}`);
console.log(`  clashes hitting the cap ${pct(cappedClashes, totalClashes)}   (want low — a capped clash is a stall)`);
console.log(`  IDLE fighters           ${pct(idleFighters, totalFighters)}   (want ~0% — an idle pet is the AI failing at squad scale)`);
console.log(`  2–0 sweeps              ${pct(sweeps, MATCHES)}`);
console.log(`  first-clash loser wins  ${pct(comebacks, MATCHES)}   (want > 15% — losing clash 1 must not end it)`);

// ── 2. Does formation change anything? ──────────────────────────────────────
// Same four pets, same opponent, same seed — only which two hold the front.
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
    const tanksForward = durable;
    const squishForward = [...durable].reverse();
    if (tanksForward.slice(0, RITE_FRONT_SLOTS).join() === squishForward.slice(0, RITE_FRONT_SLOTS).join()) continue;
    formationValid++;
    const a = runWarfrontRite(mine, theirs, seed, plan(tanksForward));
    const b = runWarfrontRite(mine, theirs, seed, plan(squishForward));
    if (a.winner === "blue") tanksForwardWins++;
    if (b.winner === "blue") squishForwardWins++;
    if (a.winner !== b.winner) formationChanged++;
}

console.log("\nFORMATION (same band, same rival, only the front line swapped)");
console.log(`  durable pets forward    ${pct(tanksForwardWins, formationValid)} wins`);
console.log(`  fragile pets forward    ${pct(squishForwardWins, formationValid)} wins`);
console.log(`  outcome CHANGED         ${pct(formationChanged, formationValid)}   (if ~0%, the tactics are decoration)`);

// ── 3. Does the better band actually win? ───────────────────────────────────
let strongWins = 0;
for (let seed = 1; seed <= MATCHES; seed++) {
    const strong = band(seed, "s").map((p) => ({ ...p, hp: Math.round(p.hp * 1.25), attack: Math.round(p.attack * 1.2) }));
    if (runWarfrontRite(strong, band(seed, "w"), seed).winner === "blue") strongWins++;
}
console.log("\nPOWER CHECK (+25% hp / +20% attack)");
console.log(`  stronger band wins      ${pct(strongWins, MATCHES)}   (want 70–95% — decisive but not certain)`);
console.log("");
