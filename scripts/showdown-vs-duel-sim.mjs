/*
 * Engine comparison harness — how far does a mode's balance move when it ports
 * off the legacy duel sim onto the Showdown engine?
 *
 *   node --import tsx scripts/showdown-vs-duel-sim.mjs [--level 50] [--seeds 3] [--top 12] [--sample 0]
 *
 * RUNTIME. The legacy sim is a tick-based cinematic engine and is roughly two
 * orders of magnitude slower than the Showdown resolver, so the full sweep is
 * MINUTES, not seconds: ~3 min per seed over the whole roster. Use
 * `--sample N` to cap each rarity pool at N species while iterating (0 = no
 * cap, the default), and run the full sweep in the background.
 *
 * WHY. Retiring the duel sim means four live entries (Arena exhibition, Pet
 * Ladder duels, Hollow Gate, Clan War) change the engine that decides their
 * fights. The two engines do not agree — they were tuned years apart against
 * different formats — so every port moves that mode's win rates. This script
 * turns "balance will shift" into a measured number BEFORE a flag flips, which
 * is the whole reason Phase 0 exists (docs/pet-duel-engine-unification-scope.md).
 *
 * WHAT IT DOES. Runs the same species-vs-species matchups, at the same level,
 * from the same seeds, through both engines, and reports:
 *
 *   - FLIP RATE: how often the two engines disagree on the same (A, B, seed).
 *     This is the headline. It is roughly "what fraction of ladder results
 *     would have gone the other way".
 *   - Per-element and per-role win rates on each engine, with the delta.
 *   - The species whose win rate moves most in each direction.
 *
 * Both engines are driven the way the LIVE Arena path drives them, so the
 * numbers describe the port that Phase 1 would actually ship:
 *   - legacy: runPetDuel(...) with the same arguments api/pet/battle-start.ts
 *     passes for a casual 1v1 (no items, accuracy off, planted motion).
 *   - showdown: a warrior-tier 1v1 session resolved headlessly, both sides on
 *     the same AI policy.
 *
 * Read-only. Prints a report and exits 0; it asserts nothing, because there is
 * no "correct" delta — the delta is the input to a product decision.
 */

import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { createShowdownSession } from '../api/_pet-showdown/engine.ts';
import { resolveShowdownHeadless } from '../api/_pet-showdown/headless.ts';
import { runPetDuel } from '../api/_pet-sim/pet-duel-sim.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const LEVEL = flag('level', 50);
const SEEDS = flag('seeds', 3);
const TOP = flag('top', 12);
/** Cap each rarity pool while iterating. 0 = the whole roster. Sampling keeps
 *  the FIRST N of each rarity — deterministic, so two sampled runs compare. */
const SAMPLE = flag('sample', 0);

// Same growth curve the Showdown balance analyzer uses, so the two reports are
// directly comparable and the comparison isolates ENGINE, not build.
const GROWTH = 1 + (LEVEL - 1) * 0.04 * 0.25;

function scaled(tpl, slot) {
    return {
        ...tpl,
        id: `${slot}:${tpl.id}`,
        templateId: tpl.id,
        level: LEVEL,
        hp: Math.round(Number(tpl.hp) * GROWTH),
        attack: Math.round(Number(tpl.attack) * GROWTH),
        defense: Math.round(Number(tpl.defense) * GROWTH),
        speed: Math.round(Number(tpl.speed) * GROWTH),
    };
}

/** Legacy duel sim, driven exactly as api/pet/battle-start.ts drives a casual 1v1. */
function legacyFight(a, b, seed) {
    const { result } = runPetDuel(a, b, seed, 1, 1, false, false, false, null, true);
    // The legacy sim can draw; Showdown's judge cannot. A draw is counted as
    // "not a win" on both sides of the comparison and reported separately, so
    // it never silently inflates either engine's win rate.
    return result;
}

/** Showdown engine, resolved headlessly with both sides on the same policy. */
function showdownFight(a, b, seed) {
    const session = createShowdownSession({
        sessionId: 'cmp', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: [a], enemyPets: [b], enemyTeamName: 'B', rewardEligible: false,
    });
    return resolveShowdownHeadless(session).outcome;
}

// ── Roster: the same wild-spawnable pool the balance analyzer uses ───────────
const byRarity = new Map();
for (const tpl of Object.values(PET_CATALOG)) {
    if (tpl.wildSpawnable === false) continue;
    if (!Array.isArray(tpl.jutsus)) continue;
    const list = byRarity.get(tpl.rarity) ?? [];
    list.push(tpl);
    byRarity.set(tpl.rarity, list);
}

const bump = (map, key, engine, won) => {
    const s = map.get(key) ?? { legacyW: 0, showdownW: 0, n: 0 };
    if (engine === 'legacy' && won) s.legacyW += 1;
    if (engine === 'showdown' && won) s.showdownW += 1;
    map.set(key, s);
    return s;
};

const species = new Map();   // templateId -> record
const elements = new Map();
const roles = new Map();
let games = 0, flips = 0, legacyDraws = 0;
let legacyWins = 0, showdownWins = 0;

for (const [rarity, fullPool] of byRarity) {
    const pool = SAMPLE > 0 ? fullPool.slice(0, SAMPLE) : fullPool;
    for (const a of pool) {
        for (const b of pool) {
            if (a.id === b.id) continue;
            for (let s = 0; s < SEEDS; s++) {
                const seed = 100_000 + s * 7919;
                const pa = scaled(a, 'a');
                const pb = scaled(b, 'b');
                const legacy = legacyFight(pa, pb, seed);
                const showdown = showdownFight(pa, pb, seed);

                const legacyWon = legacy === 'win';
                const showdownWon = showdown === 'win';
                games += 1;
                if (legacy === 'draw') legacyDraws += 1;
                if (legacyWon) legacyWins += 1;
                if (showdownWon) showdownWins += 1;
                if (legacyWon !== showdownWon) flips += 1;

                for (const [map, key] of [[species, a.id], [elements, a.element ?? 'None'], [roles, a.role ?? 'none']]) {
                    const rec = bump(map, key, 'legacy', legacyWon);
                    bump(map, key, 'showdown', showdownWon);
                    rec.n += 1;
                    if (map === species) {
                        rec.name = a.name;
                        rec.rarity = rarity;
                    }
                }
            }
        }
    }
}

// ── Report ──────────────────────────────────────────────────────────────────
const pct = (w, n) => (n ? (w / n) * 100 : 0);
const fmt = (v) => `${v.toFixed(1)}%`;
const delta = (rec) => pct(rec.showdownW, rec.n) - pct(rec.legacyW, rec.n);
const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

console.log(`\n[engine comparison] level ${LEVEL}, ${SEEDS} seed(s), ${games.toLocaleString()} matchups per engine\n`);

console.log('HEADLINE');
console.log(`  flip rate            ${fmt(pct(flips, games))}  — same pets, same seed, different winner`);
console.log(`  legacy win rate      ${fmt(pct(legacyWins, games))}${legacyDraws ? `  (${fmt(pct(legacyDraws, games))} draws)` : ''}`);
console.log(`  showdown win rate    ${fmt(pct(showdownWins, games))}`);
console.log(`  aggregate shift      ${signed(pct(showdownWins, games) - pct(legacyWins, games))} pts\n`);

const table = (title, map) => {
    console.log(title);
    const rows = [...map.entries()]
        .map(([key, rec]) => ({ key, legacy: pct(rec.legacyW, rec.n), showdown: pct(rec.showdownW, rec.n), d: delta(rec), n: rec.n }))
        .sort((x, y) => y.d - x.d);
    const width = Math.max(...rows.map((r) => r.key.length), 10);
    console.log(`  ${'key'.padEnd(width)}   legacy   showdown   delta      n`);
    for (const r of rows) {
        console.log(`  ${r.key.padEnd(width)}   ${fmt(r.legacy).padStart(6)}   ${fmt(r.showdown).padStart(8)}   ${signed(r.d).padStart(6)}   ${String(r.n).padStart(5)}`);
    }
    console.log('');
};

table('BY ELEMENT', elements);
table('BY ROLE', roles);

const speciesRows = [...species.entries()]
    .map(([id, rec]) => ({ id, ...rec, legacy: pct(rec.legacyW, rec.n), showdown: pct(rec.showdownW, rec.n), d: delta(rec) }))
    .sort((x, y) => y.d - x.d);

const printSpecies = (label, rows) => {
    console.log(label);
    for (const r of rows) {
        console.log(`  ${signed(r.d).padStart(6)} pts   ${r.name} (${r.rarity})   ${fmt(r.legacy)} → ${fmt(r.showdown)}`);
    }
    console.log('');
};
printSpecies(`SPECIES GAINING MOST (top ${TOP})`, speciesRows.slice(0, TOP));
printSpecies(`SPECIES LOSING MOST (top ${TOP})`, speciesRows.slice(-TOP).reverse());

// ── Spread: is the movement noise, or convergence? ──────────────────────────
// Raw movement alone is misleading. A species falling from 89% to 22% reads as
// a brutal nerf until you notice 89% was never a balanced number. This measures
// each engine's SPREAD against the bands the Showdown ratchet already enforces
// (comfort 25-75, hard 15-85), so the delta can be read as "the meta got
// flatter" or "the meta got wilder" rather than just "things moved".
const spreadOf = (pick) => {
    const values = speciesRows.map(pick);
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1));
    return {
        sd,
        outsideComfort: values.filter((v) => v < 25 || v > 75).length,
        outsideHard: values.filter((v) => v < 15 || v > 85).length,
    };
};
const legacySpread = spreadOf((r) => r.legacy);
const showdownSpread = spreadOf((r) => r.showdown);

console.log('SPREAD — how wide is each engine\'s meta?');
console.log(`  ${'engine'.padEnd(10)}   std dev   outside 25-75   outside 15-85`);
console.log(`  ${'legacy'.padEnd(10)}   ${legacySpread.sd.toFixed(1).padStart(7)}   ${String(legacySpread.outsideComfort).padStart(13)}   ${String(legacySpread.outsideHard).padStart(13)}`);
console.log(`  ${'showdown'.padEnd(10)}   ${showdownSpread.sd.toFixed(1).padStart(7)}   ${String(showdownSpread.outsideComfort).padStart(13)}   ${String(showdownSpread.outsideHard).padStart(13)}\n`);

const movedALot = speciesRows.filter((r) => Math.abs(r.d) >= 20).length;
console.log('READING THIS');
console.log(`  ${movedALot} of ${speciesRows.length} species move by 20+ points.`);
console.log('  The flip rate is the number to argue about: it is roughly the share of');
console.log('  ladder results that would have gone the other way on the new engine.');
console.log('  Then read SPREAD before calling any single species\' drop a nerf: if the');
console.log('  new engine\'s std dev and out-of-band counts are lower, the big movers are');
console.log('  mostly old outliers being pulled toward the middle, not fresh damage.');
console.log('  A port is a balance change either way. This measures which kind.\n');
