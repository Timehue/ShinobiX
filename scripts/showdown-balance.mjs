/*
 * Pet Showdown balance analyzer — pits every catalog species against every
 * other species OF THE SAME RARITY through the real server engine, both sides
 * driven by the same AI policy, and reports the spread:
 *
 *   node --import tsx scripts/showdown-balance.mjs [--level 50] [--seeds 3]
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

// Balanced-training growth: the same all-stat multiplier every species gets,
// so the comparison isolates SPECIES identity (base spread + kit), not builds.
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

/** Both sides run the SAME policy — the AI's own side parameter. This used to
 *  flip a shallow session copy and copy `rng` back by hand; the picker now
 *  takes the side directly, which is the identical draw sequence with none of
 *  the aliasing risk. */
function commandsFor(session, side) {
    return chooseShowdownAiCommands(session, side);
}

function fight(tplA, tplB, seed) {
    const session = createShowdownSession({
        sessionId: 'balance', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: [scaled(tplA, 'a')], enemyPets: [scaled(tplB, 'b')], enemyTeamName: 'B',
    });
    let rounds = 0;
    while (!session.finished && rounds < HARD_STOP + 1) {
        rounds += 1;
        const playerCommands = commandsFor(session, 'player');
        const enemyCommands = commandsFor(session, 'enemy');
        resolveShowdownRound(session, playerCommands, enemyCommands);
    }
    return { outcome: session.outcome, rounds: session.round, hitHardStop: session.round >= HARD_STOP };
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
let totalRounds = 0, totalGames = 0, unresolvedGames = 0;

const bump = (map, key, won) => {
    const s = map.get(key) ?? { w: 0, n: 0 };
    s.w += won ? 1 : 0;
    s.n += 1;
    map.set(key, s);
};

const BEATS = { Fire: 'Wind', Wind: 'Lightning', Lightning: 'Earth', Earth: 'Water', Water: 'Fire' };

for (const [rarity, list] of byRarity) {
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            for (let s = 0; s < SEEDS; s++) {
                const seed = 1_000_003 * (i * 251 + j) + s * 7919 + rarity.length;
                // Alternate who sits on which side so side bias cancels out.
                const [A, B] = s % 2 === 0 ? [list[i], list[j]] : [list[j], list[i]];
                const { outcome, rounds, hitHardStop } = fight(A, B, seed);
                const aWon = outcome === 'win';
                totalRounds += rounds; totalGames += 1; unresolvedGames += hitHardStop ? 1 : 0;
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

console.log(`\n=== Pet Showdown balance @ level ${LEVEL}, ${SEEDS} seeds, ${totalGames} games ===`);
console.log(`pace: avg ${(totalRounds / Math.max(1, totalGames)).toFixed(1)} rounds; unresolved at hard-stop ${(100 * unresolvedGames / Math.max(1, totalGames)).toFixed(1)}%`);
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

// ── Training relevance: every focus must beat an untrained twin ──────────────
// A pet trained all-in on ONE stat (the +396% budget channeled per the live
// growth rule, here +60% on the focused stat as a mid-game snapshot) fights
// its untrained twin. Every focus should win CLEARLY (>=65%) or that training
// choice is a trap.
//
// Driven by the REAL game AI on both sides, not the sweep's simplified policy:
// the sweep policy is symmetric so it cancels out of role/element BANDS, but
// it underuses tempo, which flattened the SPEED row to a 50% coin — the same
// question asked under chooseShowdownAiCommands reads ~88%. The swapped-view
// trick lets the enemy-side brain command the player side.
const TRAIN_SAMPLES = 60;
const aiFightWin = (trainedTpl, baseTpl, seed) => {
    const session = createShowdownSession({
        sessionId: 'train', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: [scaled(trainedTpl, 'a')], enemyPets: [scaled(baseTpl, 'b')], enemyTeamName: 'B',
    });
    let rounds = 0;
    while (!session.finished && rounds < HARD_STOP + 1) {
        rounds += 1;
        const mine = chooseShowdownAiCommands({ ...session, player: session.enemy, enemy: session.player });
        resolveShowdownRound(session, mine, chooseShowdownAiCommands(session));
    }
    return session.outcome === 'win';
};
console.log('\nTRAINING RELEVANCE (trained-in-one-stat vs untrained twin, real AI both sides):');
for (const focus of ['hp', 'attack', 'defense', 'speed']) {
    let wins = 0;
    const pool = [...byRarity.values()].flat();
    for (let s = 0; s < TRAIN_SAMPLES; s++) {
        const tpl = pool[(s * 13) % pool.length];
        const trained = { ...tpl, [focus]: Math.round(Number(tpl[focus]) * 1.6) };
        wins += aiFightWin(trained, tpl, 777_001 + s * 101) ? 1 : 0;
    }
    console.log(`  ${focus}: ${(100 * wins / TRAIN_SAMPLES).toFixed(1)}%`);
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
for (const s of species.slice(0, 10)) console.log(`  ${pct(s).toFixed(1)}%  ${s.name} (${s.rarity} ${s.element} ${s.role})`);
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
for (const s of species.slice(-10).reverse()) console.log(`  ${pct(s).toFixed(1)}%  ${s.name} (${s.rarity} ${s.element} ${s.role})`);

// Bands (mirrored by the ratchet test once tuned).
const failures = [];
for (const [role, s] of roleStats) if (pct(s) < 40 || pct(s) > 60) failures.push(`role ${role} at ${pct(s).toFixed(1)}%`);
for (const [el, s] of elementStats) if (pct(s) < 40 || pct(s) > 60) failures.push(`element ${el} at ${pct(s).toFixed(1)}%`);
for (const s of species) if (pct(s) < 25 || pct(s) > 75) failures.push(`species ${s.name} at ${pct(s).toFixed(1)}%`);
const avgRounds = totalRounds / Math.max(1, totalGames);
if (avgRounds < 5 || avgRounds > 12.5) failures.push(`avg rounds ${avgRounds.toFixed(1)} outside 5-12.5`);
if (unresolvedGames / Math.max(1, totalGames) > 0.35) failures.push(`hard-stop leaves unresolved ${(100 * unresolvedGames / totalGames).toFixed(1)}% of games`);

if (failures.length) {
    console.log(`\nBANDS VIOLATED (${failures.length}):`);
    for (const f of failures.slice(0, 25)) console.log(`  - ${f}`);
    process.exit(1);
}
console.log('\nAll balance bands hold.');
