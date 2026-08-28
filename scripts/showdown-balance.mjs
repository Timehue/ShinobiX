/*
 * Pet Showdown balance analyzer — pits every catalog species against every
 * other species OF THE SAME RARITY through the real server engine, both sides
 * driven by the same AI policy, and reports the spread:
 *
 *   node --import tsx scripts/showdown-balance.mjs [--level 50] [--seeds 3] [--bench 2]
 *
 * What "balanced" means for Showdown (mirrors the pet-role-balance ratchet):
 *   - no ROLE outside ~40-60% overall win rate,
 *   - no ELEMENT outside ~40-60% against the field (the wheel should decide
 *     individual matchups, not the aggregate),
 *   - species outliers inside ~25-75% (kits differentiate, never dominate),
 *   - typical match length 6-12 rounds, unresolved (400-round hard-stop) games a rarity.
 *
 * Read-only: prints the report and exits non-zero if a band is violated, so it
 * can back a ratchet test. Tuning happens in api/_pet-showdown/engine.ts.
 */

import { PET_CATALOG } from '../api/pet/_catalog.ts';
import {
    createShowdownSession,
    resolveShowdownRound,
} from '../api/_pet-showdown/engine.ts';
import { chooseShowdownAiCommands } from '../api/_pet-showdown/ai.ts';
import { SHOWDOWN_BENCH_SIZE, SHOWDOWN_TURN_CAP } from '../shared/pet-showdown-contract.ts';
// Sim-only backstop. The engine judges every match at SHOWDOWN_TURN_CAP (25)
// so this can only fire if the judge ever stopped firing — it is a bug tripwire,
// not the round limit. (It predates the judge, when the engine had no cap.)
const HARD_STOP = 400;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const LEVEL = flag('level', 50);
const SEEDS = flag('seeds', 3);
/** Reserves parked behind each fighter. The default is the live Colosseum team
 * shape; --bench 0 remains available as a focused duel diagnostic. Several move
 * kinds act on the bench, so the release audit must keep rotation and trapping
 * live instead of measuring their degenerate no-bench fallbacks. */
const BENCH = flag('bench', SHOWDOWN_BENCH_SIZE);

function balancedAllocation(level) {
    const earned = Math.max(0, level - 1);
    const each = Math.floor(earned / 4);
    return { vitality: each + (earned % 4 > 0 ? 1 : 0), power: each + (earned % 4 > 1 ? 1 : 0), guard: each + (earned % 4 > 2 ? 1 : 0), agility: each };
}

function focusedAllocation(level, focusStat) {
    const keyFor = { hp: 'vitality', attack: 'power', defense: 'guard', speed: 'agility' };
    const focus = keyFor[focusStat];
    const earned = Math.max(0, level - 1);
    const cap = Math.ceil(earned / 2);
    const out = balancedAllocation(level);
    const shift = Math.min(cap - out[focus], Math.max(1, Math.round(earned * 0.08)));
    out[focus] += shift;
    const others = Object.keys(out).filter((key) => key !== focus);
    for (let i = 0; i < shift; i++) {
        const key = others[i % others.length];
        out[key] -= 1;
    }
    return out;
}

function scaled(tpl, slot) {
    return {
        ...tpl,
        id: `${slot}:${tpl.id}`,
        templateId: tpl.id,
        level: LEVEL,
        growthBaseStats: { hp: Number(tpl.hp), attack: Number(tpl.attack), defense: Number(tpl.defense), speed: Number(tpl.speed) },
        growthAllocation: tpl.__showdownAllocation ?? balancedAllocation(LEVEL),
    };
}

/** Both sides run the SAME policy — the AI's own side parameter. This used to
 *  flip a shallow session copy and copy `rng` back by hand; the picker now
 *  takes the side directly, which is the identical draw sequence with none of
 *  the aliasing risk. */
function commandsFor(session, side) {
    return chooseShowdownAiCommands(session, side);
}

/** A fixed neutral reserve, IDENTICAL on both sides so it cancels out of the
 *  comparison. Picking the species under test as its own reserve would make the
 *  bench a second copy of the thing being measured. */
const benchFiller = Object.values(PET_CATALOG)
    .filter((t) => t.wildSpawnable !== false && Array.isArray(t.jutsus) && t.rarity === 'standard')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];

function teamFor(tpl, slot) {
    const team = [scaled(tpl, slot)];
    for (let i = 0; i < BENCH; i++) team.push(scaled(benchFiller, `${slot}bench${i}`));
    return team;
}

function fight(tplA, tplB, seed) {
    const session = createShowdownSession({
        sessionId: 'balance', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: teamFor(tplA, 'a'), enemyPets: teamFor(tplB, 'b'), enemyTeamName: 'B',
    });
    let rounds = 0;
    // Round COMPOSITION: what the AI actually spends its turns on. A long match
    // can mean slow kills or it can mean nobody committing; these separate the
    // two.
    let cmds = 0, switches = 0, rests = 0, guards = 0;
    while (!session.finished && rounds < HARD_STOP + 1) {
        rounds += 1;
        const playerCommands = commandsFor(session, 'player');
        const enemyCommands = commandsFor(session, 'enemy');
        for (const c of [...playerCommands, ...enemyCommands]) {
            cmds += 1;
            if (c.kind === 'switch') switches += 1;
            else if (c.kind === 'rest') rests += 1;
            else if (c.kind === 'guard') guards += 1;
        }
        resolveShowdownRound(session, playerCommands, enemyCommands);
    }
    return {
        outcome: session.outcome,
        rounds: session.round,
        hitHardStop: session.round >= HARD_STOP,
        // Decided by the ROUND-CAP JUDGE rather than by a knockout. This is the
        // number that separates "matches are longer" from "nobody actually
        // wins" — a judged match ends on a tiebreak, not on a finish.
        judged: session.round >= SHOWDOWN_TURN_CAP,
        cmds, switches, rests, guards,
    };
}

const byRarity = new Map();
for (const tpl of Object.values(PET_CATALOG)) {
    if (tpl.wildSpawnable === false) continue;   // starters/evolved forms sit outside the wild pool
    if (!Array.isArray(tpl.jutsus)) continue;
    const list = byRarity.get(tpl.rarity) ?? [];
    list.push(tpl);
    byRarity.set(tpl.rarity, list);
}

const speciesStats = new Map();  // id -> {w, n, name, role, element, rarity}
const roleStats = new Map();
const elementStats = new Map();
const elementEdge = { advWins: 0, advGames: 0 };
let totalRounds = 0, totalGames = 0, unresolvedGames = 0, judgedGames = 0;
let totalCmds = 0, totalSwitches = 0, totalRests = 0, totalGuards = 0;

const bump = (map, key, won) => {
    const s = map.get(key) ?? { w: 0, n: 0 };
    s.w += won ? 1 : 0;
    s.n += 1;
    map.set(key, s);
};

const BEATS = { Fire: 'Wind', Wind: 'Lightning', Lightning: 'Earth', Earth: 'Water', Water: 'Fire' };

/* Seeds are scaled UP for small pools so every species gets a comparable
 * sample. The pools are wildly uneven — standard and rare hold 50 species each,
 * mythic holds 10 — so a flat seed count gave a mythic species 18 games while a
 * standard got 98. At 18 games the reportable win rates are quantised to 5.6%
 * steps with a ~+/-23 point confidence interval, which manufactured "outliers"
 * out of pure noise: Eclipse Kitsune read 22.2% and 83.3% either side of a
 * single 15% element tweak. Tuning a kit against that is fitting to a coin
 * flip. */
const MIN_GAMES_PER_SPECIES = 60;
// Each species meets (poolSize - 1) opponents once per seed, so that product
// IS its game count — no factor of two.
const seedsFor = (poolSize) => Math.max(SEEDS, Math.ceil(MIN_GAMES_PER_SPECIES / Math.max(1, poolSize - 1)));

for (const [rarity, list] of byRarity) {
    const seedsHere = seedsFor(list.length);
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            for (let s = 0; s < seedsHere; s++) {
                const seed = 1_000_003 * (i * 251 + j) + s * 7919 + rarity.length;
                // Alternate who sits on which side so side bias cancels out.
                const [A, B] = s % 2 === 0 ? [list[i], list[j]] : [list[j], list[i]];
                const { outcome, rounds, hitHardStop, judged, cmds, switches, rests, guards } = fight(A, B, seed);
                totalCmds += cmds; totalSwitches += switches; totalRests += rests; totalGuards += guards;
                const aWon = outcome === 'win';
                totalRounds += rounds; totalGames += 1; unresolvedGames += hitHardStop ? 1 : 0;
                judgedGames += judged ? 1 : 0;
                for (const [tpl, won] of [[A, aWon], [B, !aWon]]) {
                    bump(speciesStats, tpl.id, won);
                    const sp = speciesStats.get(tpl.id);
                    Object.assign(sp, { name: tpl.name, role: tpl.role, element: tpl.element, rarity });
                    bump(roleStats, tpl.role ?? 'none', won);
                    bump(elementStats, tpl.element ?? 'None', won);
                }
                if (BEATS[A.element] === B.element) { elementEdge.advGames += 1; elementEdge.advWins += aWon ? 1 : 0; }
                else if (BEATS[B.element] === A.element) { elementEdge.advGames += 1; elementEdge.advWins += aWon ? 0 : 1; }
            }
        }
    }
}

const pct = (s) => (100 * s.w / Math.max(1, s.n));
const fmtMap = (map) => [...map.entries()]
    .map(([k, s]) => `${k}: ${pct(s).toFixed(1)}% (${s.n})`)
    .join('  ·  ');

console.log(`\n=== Pet Showdown balance @ level ${LEVEL}, ${SEEDS} seeds, ${BENCH} reserve(s), ${totalGames} games ===`);
console.log(`pace: avg ${(totalRounds / Math.max(1, totalGames)).toFixed(1)} rounds; unresolved at hard-stop ${(100 * unresolvedGames / Math.max(1, totalGames)).toFixed(1)}%`);
console.log(`decided by the round-cap JUDGE (no knockout): ${(100 * judgedGames / Math.max(1, totalGames)).toFixed(1)}%`);
{
    const pc = (n) => `${(100 * n / Math.max(1, totalCmds)).toFixed(1)}%`;
    const committed = totalCmds - totalSwitches - totalRests - totalGuards;
    console.log(`turn spend: attacks ${pc(committed)} · switches ${pc(totalSwitches)} · rests ${pc(totalRests)} · guards ${pc(totalGuards)}`);
}
console.log(`element-advantage matchup win rate: ${(100 * elementEdge.advWins / Math.max(1, elementEdge.advGames)).toFixed(1)}% of ${elementEdge.advGames}`);
console.log(`\nROLES     ${fmtMap(roleStats)}`);
console.log(`ELEMENTS  ${fmtMap(elementStats)}`);

// ── Per-KIND analysis: which move kinds drag their carriers down? ────────────
// Presence-weighted: a species' win rate is credited to every kind in its kit,
// so a kind whose carriers systematically lose surfaces as a low number.
const kindStats = new Map();
for (const [rarity, list] of byRarity) {
    void rarity;
    for (const tpl of list) {
        const s = speciesStats.get(tpl.id);
        if (!s) continue;
        const kinds = new Set(tpl.jutsus.map((j) => j.kind));
        for (const kind of kinds) {
            const k = kindStats.get(kind) ?? { w: 0, n: 0, species: 0 };
            k.w += s.w;
            k.n += s.n;
            k.species += 1;   // HOW MANY SPECIES back this number
            kindStats.set(kind, k);
        }
    }
}
// The species count is not decoration — it is the difference between a finding
// and a coincidence. Several kinds are carried by a handful of pets (absorb by
// ONE), so their win rate is that pet's win rate wearing a category's name.
// Printing the rate alone invites reading `absorb: 33%` as "absorb is
// underpowered" when it means "one specific pet is weak". Kinds below the
// threshold are listed separately so they can't be mistaken for a trend.
const KIND_SIGNAL_MIN = 20;   // species needed before a kind's rate means anything
const kindRows = [...kindStats.entries()].sort((a, b) => pct(a[1]) - pct(b[1]));
const fmtKind = ([k, s]) => `${k}: ${pct(s).toFixed(1)}% (${s.species})`;
console.log(`\nKIND CARRIERS (win rate of species carrying each move kind; (n) = species):`);
console.log(kindRows.filter(([, s]) => s.species >= KIND_SIGNAL_MIN).map(fmtKind).join('  ·  '));
console.log(`  too few carriers to read as a trend (<${KIND_SIGNAL_MIN} species):`);
console.log(`  ${kindRows.filter(([, s]) => s.species < KIND_SIGNAL_MIN).map(fmtKind).join('  ·  ')}`);

// ── Build relevance: a legal moderate tilt vs a balanced twin ───────────────
// Move roughly 8% of the earned budget into one attribute and fight both sides
// of the matchup. This is diagnostic rather than a hard band: roles and kits
// value attributes differently, but no row should imply a universal auto-win.
const TRAIN_SAMPLES = 60;
const aiFightWin = (trainedTpl, baseTpl, seed) => {
    const session = createShowdownSession({
        sessionId: 'train', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: [scaled(trainedTpl, 'a')], enemyPets: [scaled(baseTpl, 'b')], enemyTeamName: 'B',
    });
    let rounds = 0;
    while (!session.finished && rounds < HARD_STOP + 1) {
        rounds += 1;
        resolveShowdownRound(session, commandsFor(session, 'player'), commandsFor(session, 'enemy'));
    }
    return session.outcome === 'win';
};
console.log('\nBUILD RELEVANCE (+8%-budget tilt vs balanced twin, real AI both sides):');
for (const focus of ['hp', 'attack', 'defense', 'speed']) {
    let wins = 0, games = 0;
    const pool = [...byRarity.values()].flat();
    for (let s = 0; s < TRAIN_SAMPLES; s++) {
        const tpl = pool[(s * 13) % pool.length];
        const trained = { ...tpl, __showdownAllocation: focusedAllocation(LEVEL, focus) };
        const balanced = { ...tpl, __showdownAllocation: balancedAllocation(LEVEL) };
        const seed = 777_001 + s * 101;
        wins += aiFightWin(trained, balanced, seed) ? 1 : 0;
        wins += aiFightWin(balanced, trained, seed + 53) ? 0 : 1;
        games += 2;
    }
    console.log(`  ${focus}: ${(100 * wins / games).toFixed(1)}%`);
}

// ── Cross-rarity spot check: higher rarity should win, sanely ────────────────
const CROSS_SAMPLES = 40;
const rarityOrder = ['standard', 'rare', 'legendary', 'mythic'];
console.log('\nCROSS-RARITY (higher-tier win rate, sampled):');
for (let r = 0; r < rarityOrder.length - 1; r++) {
    const low = byRarity.get(rarityOrder[r]) ?? [];
    const high = byRarity.get(rarityOrder[r + 1]) ?? [];
    if (!low.length || !high.length) continue;
    let wins = 0, games = 0;
    for (let s = 0; s < CROSS_SAMPLES; s++) {
        const tplHigh = high[(s * 7) % high.length];
        // SAME-ELEMENT pairing — the 1.5x wheel would otherwise swamp the
        // tier gap this sample exists to measure.
        const sameElement = low.filter((t) => t.element === tplHigh.element);
        const pool = sameElement.length ? sameElement : low;
        const tplLow = pool[(s * 11) % pool.length];
        const { outcome } = fight(tplHigh, tplLow, 900_001 + s * 6007);
        games += 1;
        wins += outcome === 'win' ? 1 : 0;
    }
    console.log(`  ${rarityOrder[r + 1]} vs ${rarityOrder[r]}: ${(100 * wins / games).toFixed(1)}% (${games})`);
}

const species = [...speciesStats.values()].sort((a, b) => pct(a) - pct(b));
console.log('\nWeakest 10:');
for (const s of species.slice(0, 10)) console.log(`  ${pct(s).toFixed(1)}%  ${s.name} (${s.rarity} ${s.element} ${s.role}) n=${s.n}`);
// --focus "Name,Name" — print these species' exact win rates (kit surgery
// needs the number for the species being edited, not just the top/bottom ten).
const focusArg = process.argv.includes('--focus') ? process.argv[process.argv.indexOf('--focus') + 1] : '';
if (focusArg) {
    const wanted = focusArg.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
    console.log('\nFOCUS:');
    for (const s of species) {
        if (wanted.some((w) => s.name.toLowerCase() === w)) {
            console.log(`  ${pct(s).toFixed(1)}%  ${s.name} (${s.rarity} ${s.element} ${s.role})`);
        }
    }
}
console.log('Strongest 10:');
for (const s of species.slice(-10).reverse()) console.log(`  ${pct(s).toFixed(1)}%  ${s.name} (${s.rarity} ${s.element} ${s.role}) n=${s.n}`);

// Bands (mirrored by the ratchet test once tuned).
const failures = [];
for (const [role, s] of roleStats) if (pct(s) < 40 || pct(s) > 60) failures.push(`role ${role} at ${pct(s).toFixed(1)}%`);
for (const [el, s] of elementStats) if (pct(s) < 40 || pct(s) > 60) failures.push(`element ${el} at ${pct(s).toFixed(1)}%`);
for (const s of species) if (pct(s) < 25 || pct(s) > 75) failures.push(`species ${s.name} at ${pct(s).toFixed(1)}%`);
const avgRounds = totalRounds / Math.max(1, totalGames);
// Pace bands depend on the SHAPE being simulated: one fighter per side is a
// different game from a team with reserves, and three pets legitimately take
// about three times as long to resolve.
const [paceLo, paceHi] = BENCH > 0 ? [13, 26] : [5, 12.5];
if (avgRounds < paceLo || avgRounds > paceHi) failures.push(`avg rounds ${avgRounds.toFixed(1)} outside ${paceLo}-${paceHi}`);
// A match should be WON, not awarded. Only meaningful with reserves in play:
// a benchless fight cannot reach the cap.
if (BENCH > 0 && judgedGames / Math.max(1, totalGames) > 0.2) {
    failures.push(`${(100 * judgedGames / totalGames).toFixed(1)}% of matches decided by the round-cap judge`);
}
if (unresolvedGames / Math.max(1, totalGames) > 0.35) failures.push(`hard-stop leaves unresolved ${(100 * unresolvedGames / totalGames).toFixed(1)}% of games`);

if (failures.length) {
    console.log(`\nBANDS VIOLATED (${failures.length}):`);
    for (const f of failures.slice(0, 25)) console.log(`  - ${f}`);
    process.exit(1);
}
console.log('\nAll balance bands hold.');
