/*
 * Headless balance/feel harness for the NEW cinematic coliseum engine
 * (shinobij.client/src/lib/pet-duel-cinematic.ts). Gates the redesign:
 *   1. DETERMINISM — same pets + seed → byte-identical DuelResult (1v1 + 2v2).
 *   2. NO STALLS — ~zero duels reach the cap with both fighters healthy.
 *   3. DECISIVE — high true-KO rate (a real finisher, not a timer-draw).
 *   4. LENGTH — median in a watchable window (+ per-matchup medians).
 *   5. MIRROR FAIRNESS — a pet vs an identical clone wins ~50% (no side bias).
 *   6. STRONGER WINS — a clearly stronger pet wins from either side.
 *   7. MOVEMENT IS REAL — average engagement distance (positioning isn't cosmetic).
 *   8. WHIFF RATE — melee misses stay in a sane band (not a whiff-storm).
 *   9. PER-ARCHETYPE win% — no archetype collapses (<35%) or dominates (>65%).
 *  10. MELEE↔RANGED parity — the pounce/whiff system didn't hand it to zoners.
 *  11. SPEED-INVERSION — a strong+slow pet still beats a weak+fast dodger.
 *  12. SIGNATURE LAND-RATE — the marquee move mostly connects.
 *  13. 2v2 PARTY — the party path (never previously exercised) is sound.
 *
 * Run:  node --import tsx scripts/pet-cinematic-harness.ts
 */
import { runPetDuelCinematic, runPetPartyDuelCinematic, petCinematicArchetype, type Archetype } from "../shinobij.client/src/lib/pet-duel-cinematic";
import { DUEL_TPS } from "../shinobij.client/src/lib/pet-duel-sim";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import type { Pet } from "../shinobij.client/src/types/pet";

const allPets = rawPetPool.map(balanceBuiltInPetTemplate);
const pool = allPets.filter((p) => p.rarity === "rare");
// A broader, rarity-mixed sample so the per-archetype + melee/ranged buckets are
// actually populated (not just rares). Deterministic slice — no randomness.
const mixed = ["common", "uncommon", "rare", "epic"].flatMap((r) => allPets.filter((p) => p.rarity === r).filter((_, i) => i % 3 === 0));
const SEEDS = Array.from({ length: 12 }, (_, i) => i * 131 + 11);
const CAP = DUEL_TPS * 75;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const pctile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] ?? 0; };
const sec = (ticks: number) => (ticks / DUEL_TPS).toFixed(1);
const pct = (num: number, den: number) => (100 * num / Math.max(1, den)).toFixed(1);
const RANGED_ARCHES: Archetype[] = ["kiter", "support"];
const isRanged = (p: Pet) => RANGED_ARCHES.includes(petCinematicArchetype(p));

// ── 1. Determinism (1v1 + 2v2) ───────────────────────────────────────────────
let detOk = true;
for (const seed of SEEDS.slice(0, 4)) {
    const a = runPetDuelCinematic(pool[0], pool[5], seed);
    const b = runPetDuelCinematic(pool[0], pool[5], seed);
    if (JSON.stringify(a) !== JSON.stringify(b)) { detOk = false; break; }
    const pa = runPetPartyDuelCinematic(pool[0], pool[1], pool[5], pool[6], seed);
    const pb = runPetPartyDuelCinematic(pool[0], pool[1], pool[5], pool[6], seed);
    if (JSON.stringify(pa) !== JSON.stringify(pb)) { detOk = false; break; }
}
console.log(`1. DETERMINISM (1v1 + 2v2): ${detOk ? "PASS — same seed → identical result" : "FAIL — non-deterministic!"}`);

// ── 2–4, 8, 12. Length / decisiveness / stalls / whiff / signature over a round-robin
const sample = pool.filter((_, i) => i % 2 === 0);   // every other rare — representative, fast
let n = 0, koWins = 0, capHits = 0, stalls = 0;
let hitEv = 0, whiffEv = 0, sigCasts = 0, sigLands = 0, clashStag = 0;
const lens: number[] = [];
const engageDists: number[] = [];
const roamAvg: number[] = [];   // mean fighter distance-from-center over a fight (how much the fight leaves the middle)
const roamMax: number[] = [];   // farthest a fighter got from center (does the fight reach the edges?)
for (const a of sample) for (const b of sample) {
    if (a.id === b.id) continue;
    for (const seed of SEEDS.slice(0, 4)) {
        const r = runPetDuelCinematic(a, b, seed);
        n++; lens.push(r.ticks);
        if (r.events.some((e) => e.type === "ko")) koWins++;
        for (const e of r.events) {
            if (e.type === "hit") { hitEv++; if (e.signature) sigLands++; }
            else if (e.type === "whiff") whiffEv++;
            else if (e.type === "ultimate") sigCasts++;
            else if (e.type === "stagger" && e.move === "Clash") clashStag++;
        }
        if (r.ticks >= CAP) {
            capHits++;
            const last = r.snapshots[r.snapshots.length - 1];
            let pHp = 0, pMax = 0, eHp = 0, eMax = 0;
            for (const ac of last.actors) { if (ac.team === "player") { pHp += ac.hp; pMax += ac.maxHp; } else { eHp += ac.hp; eMax += ac.maxHp; } }
            if (pHp / pMax > 0.6 && eHp / eMax > 0.6) stalls++;
        }
        let dsum = 0, dn = 0, csum = 0, cmax = 0;
        for (let i = 0; i < r.snapshots.length; i += 15) {
            const s = r.snapshots[i]; if (s.actors.length < 2) continue;
            const [p, e] = s.actors; if (p.hp <= 0 || e.hp <= 0) continue;
            dsum += Math.hypot(e.x - p.x, e.y - p.y); dn++;
            for (const ac of s.actors) { const cd = Math.hypot(ac.x, ac.y); csum += cd; if (cd > cmax) cmax = cd; }
        }
        if (dn) { engageDists.push(dsum / dn); roamAvg.push(csum / (dn * 2)); roamMax.push(cmax); }
    }
}
console.log(`\n2. LENGTH: median ${sec(median(lens))}s  p95 ${sec(pctile(lens, 0.95))}s  cap-hits ${pct(capHits, n)}%   (${n} duels)`);
console.log(`3. DECISIVE (true KO): ${pct(koWins, n)}%   want ≥80%`);
console.log(`4. NO STALLS (cap with both >60% HP): ${(100 * stalls / n).toFixed(2)}%   want ~0%`);
console.log(`   avg engagement distance: ${(engageDists.reduce((s, x) => s + x, 0) / Math.max(1, engageDists.length)).toFixed(2)} field-units`);
console.log(`   ROAM: mean dist-from-center ${(roamAvg.reduce((s, x) => s + x, 0) / Math.max(1, roamAvg.length)).toFixed(2)}, avg farthest reach ${(roamMax.reduce((s, x) => s + x, 0) / Math.max(1, roamMax.length)).toFixed(2)} (higher = the fight uses more of the ring, not camping center)`);
console.log(`8. WHIFF RATE: ${pct(whiffEv, whiffEv + hitEv)}% of attack outcomes   want ~15–45% (misses matter, not a whiff-storm)`);
console.log(`12. SIGNATURE LAND-RATE: ${pct(sigLands, sigCasts)}% of ${sigCasts} casts connect   want ≥45%`);
console.log(`    CLASH-RATE: ${(clashStag / 2 / n).toFixed(2)} clashes/duel   want rare (≲1) so the deflection doesn't lengthen fights`);

// ── 5. Mirror fairness ───────────────────────────────────────────────────────
let mW = 0, mN = 0;
for (const p of pool) for (const seed of SEEDS) {
    const r = runPetDuelCinematic(p, p, seed);
    if (r.result !== "draw") { mN++; if (r.result === "win") mW++; }
}
console.log(`\n5. MIRROR: player wins ${pct(mW, mN)}% of ${mN} decisive   want 42–58%`);

// ── 6. Stronger wins (both sides) ────────────────────────────────────────────
const strong: Partial<Pet> = { hp: 1200, attack: 150, defense: 90, speed: 120 };
const weak: Partial<Pet> = { hp: 500, attack: 55, defense: 30, speed: 60 };
const mk = (base: Pet, ov: Partial<Pet>): Pet => ({ ...base, ...ov });
let sBlue = 0, sRed = 0;
for (const seed of SEEDS) {
    if (runPetDuelCinematic(mk(pool[0], strong), mk(pool[0], weak), seed).result === "win") sBlue++;
    if (runPetDuelCinematic(mk(pool[0], weak), mk(pool[0], strong), seed).result === "loss") sRed++;
}
console.log(`6. STRONGER WINS: as blue ${sBlue}/${SEEDS.length}, as red ${sRed}/${SEEDS.length}   want ~all`);

// ── 7. Type advantage ────────────────────────────────────────────────────────
let advW = 0, advN = 0;
const fireVsWind = pool.map((p) => ({ ...p, element: "Fire" as const }));
for (const p of fireVsWind.slice(0, 8)) for (const seed of SEEDS.slice(0, 6)) {
    const foe = { ...p, element: "Wind" as const };
    if (runPetDuelCinematic(p, foe, seed).result === "win") advW++;
    advN++;
    if (runPetDuelCinematic(foe, p, seed).result === "loss") advW++;
    advN++;
}
console.log(`7. TYPE ADVANTAGE: the countering element wins ${pct(advW, advN)}%   want >50% (advantage helps, not auto-win)`);

// ── 9. Per-archetype win-matrix (credit winner/loser by archetype) ───────────
const archs: Archetype[] = ["rusher", "brawler", "kiter", "defender", "support", "balanced"];
const aWin: Record<string, number> = {}, aTot: Record<string, number> = {};
for (const a of archs) { aWin[a] = 0; aTot[a] = 0; }
// Balanced sample: up to 5 pets PER archetype so every bucket is populated (a plain
// slice misses the rarer archetypes). Deterministic (first-N per group).
const byArch: Record<string, Pet[]> = {}; for (const a of archs) byArch[a] = [];
for (const p of allPets) { const k = petCinematicArchetype(p); if (byArch[k].length < 5) byArch[k].push(p); }
const asample = archs.flatMap((a) => byArch[a]);
for (const a of asample) for (const b of asample) {
    if (a.id === b.id) continue;
    const ra = petCinematicArchetype(a), rb = petCinematicArchetype(b);
    for (const seed of SEEDS.slice(0, 3)) {
        const r = runPetDuelCinematic(a, b, seed);
        if (r.result === "draw") continue;
        aTot[ra]++; aTot[rb]++;
        if (r.result === "win") aWin[ra]++; else aWin[rb]++;
    }
}
console.log(`\n9. PER-ARCHETYPE win% (want each 35–65, none collapsed/dominant):`);
let archOk = true;
for (const a of archs) {
    if (aTot[a] < 20) { console.log(`   ${a.padEnd(9)} — n=${aTot[a]} (too few to judge)`); continue; }
    const w = 100 * aWin[a] / aTot[a];
    const flag = w < 35 || w > 65 ? "  ⚠️ OUT OF BAND" : "";
    if (w < 35 || w > 65) archOk = false;
    console.log(`   ${a.padEnd(9)} ${w.toFixed(1)}%  (n=${aTot[a]})${flag}`);
}
console.log(`   → ${archOk ? "PASS" : "REVIEW: an archetype is out of the 35–65 band"}`);

// ── 10. Melee↔ranged parity ──────────────────────────────────────────────────
const melees = mixed.filter((p) => !isRanged(p)).slice(0, 10);
const rangeds = mixed.filter((p) => isRanged(p)).slice(0, 10);
let mrMeleeWins = 0, mrN = 0;
for (const m of melees) for (const g of rangeds) for (const seed of SEEDS.slice(0, 3)) {
    if (runPetDuelCinematic(m, g, seed).result === "win") mrMeleeWins++;
    mrN++;
    if (runPetDuelCinematic(g, m, seed).result === "loss") mrMeleeWins++;   // melee on red beats ranged on blue
    mrN++;
}
console.log(`\n10. MELEE↔RANGED: melee side wins ${pct(mrMeleeWins, mrN)}% of ${mrN}   want 45–55 (${melees.length} melee × ${rangeds.length} ranged)`);

// ── 11. Speed-inversion (strong+slow should still beat weak+fast dodger) ─────
const slowStrong: Partial<Pet> = { hp: 1000, attack: 150, defense: 80, speed: 60 };
const fastWeak: Partial<Pet> = { hp: 700, attack: 55, defense: 40, speed: 120 };
let ssWins = 0, ssN = 0;
for (const seed of SEEDS) {
    if (runPetDuelCinematic(mk(pool[0], slowStrong), mk(pool[0], fastWeak), seed).result === "win") ssWins++;
    ssN++;
    if (runPetDuelCinematic(mk(pool[0], fastWeak), mk(pool[0], slowStrong), seed).result === "loss") ssWins++;
    ssN++;
}
console.log(`11. SPEED-INVERSION: strong+slow beats weak+fast ${pct(ssWins, ssN)}% of ${ssN}   want >60 (speed doesn't trump a big stat gap)`);

// ── 13. 2v2 party path ───────────────────────────────────────────────────────
let pN = 0, pKo = 0, pCap = 0, pStall = 0, pMirrorW = 0, pMirrorN = 0;
const plens: number[] = [];
const psample = pool.filter((_, i) => i % 3 === 0).slice(0, 8);
for (let i = 0; i < psample.length; i++) for (let j = 0; j < psample.length; j++) {
    if (i === j) continue;
    const pl = psample[i], pr = psample[(i + 1) % psample.length];
    const el = psample[j], er = psample[(j + 1) % psample.length];
    for (const seed of SEEDS.slice(0, 3)) {
        const r = runPetPartyDuelCinematic(pl, pr, el, er, seed);
        pN++; plens.push(r.ticks);
        if (r.events.some((e) => e.type === "ko")) pKo++;
        if (r.ticks >= CAP) {
            pCap++;
            const last = r.snapshots[r.snapshots.length - 1];
            let a = 0, am = 0, b = 0, bm = 0;
            for (const ac of last.actors) { if (ac.team === "player") { a += ac.hp; am += ac.maxHp; } else { b += ac.hp; bm += ac.maxHp; } }
            if (a / am > 0.6 && b / bm > 0.6) pStall++;
        }
    }
}
for (const p of psample) for (const q of psample) for (const seed of SEEDS.slice(0, 4)) {
    const r = runPetPartyDuelCinematic(p, q, p, q, seed);   // identical teams → mirror
    if (r.result !== "draw") { pMirrorN++; if (r.result === "win") pMirrorW++; }
}
console.log(`\n13. 2v2 PARTY (${pN} duels): median ${sec(median(plens))}s  true-KO ${pct(pKo, pN)}%  stalls ${(100 * pStall / pN).toFixed(2)}%  mirror ${pct(pMirrorW, pMirrorN)}% (want 42–58)`);
