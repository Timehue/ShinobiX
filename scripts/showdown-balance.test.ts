/*
 * Pet Showdown balance ratchet — CI guard for the tuning constants in
 * api/_pet-showdown/engine.ts (DAMAGE_SCALE, ROLE_DAMAGE_MULT,
 * ELEMENT_DAMAGE/TAKEN_MULT, the species budget normalization) and the wheel
 * constants in shared/pet-showdown-contract.ts.
 *
 * IT FIGHTS THE SHAPE THE MODE IS ACTUALLY PLAYED IN: one fighter per side
 * plus SHOWDOWN_BENCH_SIZE reserves. This used to run a bare 1v1 with no
 * bench, which is not a format the game offers, and the difference was not
 * cosmetic — with reserves in play, matches ran 23.7 rounds instead of 7.9 and
 * MORE THAN HALF were decided by the round-cap judge instead of a knockout,
 * none of which this file could see. A ratchet that guards the wrong shape
 * reports green while the real mode drifts.
 *
 * Runs a REDUCED slice of scripts/showdown-balance.mjs (every rarity, 1 seed —
 * fully deterministic) so the suite stays fast; the full sweep lives in the
 * analyzer script for tuning sessions. Bands carry sampling slack — a change
 * that pushes a ROLE or ELEMENT outside 35-65 on this slice, stalls the pace,
 * leaves matches undecided, or breaches the per-species bands is a balance
 * regression, not noise.
 *
 * Modeled on scripts/pet-role-balance.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.js';
import { chooseShowdownAiCommands } from '../api/_pet-showdown/ai.js';
import { SHOWDOWN_BENCH_SIZE, SHOWDOWN_TURN_CAP } from '../shared/pet-showdown-contract.js';
// Sim-only backstop. The engine judges at SHOWDOWN_TURN_CAP, so this can only
// fire if the judge stopped firing — a bug tripwire, not the round limit.
const HARD_STOP = 400;
import type { Pet } from '../api/_pet-sim/pet-types.js';
import type { ShowdownSession } from '../api/_pet-showdown/engine.js';

const LEVEL = 50;
const GROWTH = 1 + (LEVEL - 1) * 0.04 * 0.25;
const RARITIES = new Set(['standard', 'rare', 'legendary', 'mythic']);

function scaled(tpl: Record<string, unknown>, slot: string): Pet {
    return {
        ...(tpl as unknown as Pet),
        id: `${slot}:${String(tpl.id)}`,
        templateId: String(tpl.id),
        level: LEVEL,
        hp: Math.round(Number(tpl.hp) * GROWTH),
        attack: Math.round(Number(tpl.attack) * GROWTH),
        defense: Math.round(Number(tpl.defense) * GROWTH),
        speed: Math.round(Number(tpl.speed) * GROWTH),
    };
}

function commandsFor(session: ShowdownSession, side: 'player' | 'enemy') {
    // Both sides run the same policy through the AI's own side parameter.
    return chooseShowdownAiCommands(session, side);
}

/** A fixed neutral reserve, identical on both sides so it cancels out. */
let benchFiller: Record<string, unknown> | undefined;

function teamFor(tpl: Record<string, unknown>, slot: string): Pet[] {
    const team = [scaled(tpl, slot)];
    for (let i = 0; i < SHOWDOWN_BENCH_SIZE; i++) team.push(scaled(benchFiller!, `${slot}b${i}`));
    return team;
}

function fight(tplA: Record<string, unknown>, tplB: Record<string, unknown>, seed: number) {
    const session = createShowdownSession({
        sessionId: 'ratchet', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: teamFor(tplA, 'a'), enemyPets: teamFor(tplB, 'b'), enemyTeamName: 'B',
    });
    let guard = 0;
    while (!session.finished && guard < HARD_STOP + 1) {
        guard += 1;
        const playerCommands = commandsFor(session, 'player');
        const enemyCommands = commandsFor(session, 'enemy');
        resolveShowdownRound(session, playerCommands, enemyCommands);
    }
    return {
        won: session.outcome === 'win',
        rounds: session.round,
        // Decided on a tiebreak rather than by a knockout.
        judged: session.round >= SHOWDOWN_TURN_CAP,
    };
}

test('showdown balance bands hold across EVERY rarity, chase tiers included', () => {
    const byRarity = new Map<string, Record<string, unknown>[]>();
    for (const tpl of Object.values(PET_CATALOG)) {
        const rarity = String(tpl.rarity);
        if (!RARITIES.has(rarity) || tpl.wildSpawnable === false || !Array.isArray(tpl.jutsus)) continue;
        (byRarity.get(rarity) ?? byRarity.set(rarity, []).get(rarity)!).push(tpl);
    }

    benchFiller = [...byRarity.values()].flat()
        .filter((t) => String(t.rarity) === 'standard')
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    assert.ok(benchFiller, 'a standard species is available as the neutral reserve');

    const roleStats = new Map<string, { w: number; n: number }>();
    const elementStats = new Map<string, { w: number; n: number }>();
    const speciesStats = new Map<string, { w: number; n: number }>();
    let totalRounds = 0, totalGames = 0, unresolvedGames = 0, judgedGames = 0;
    const bump = (map: Map<string, { w: number; n: number }>, key: string, won: boolean) => {
        const s = map.get(key) ?? { w: 0, n: 0 };
        s.w += won ? 1 : 0; s.n += 1;
        map.set(key, s);
    };

    /* Seeds scale UP for small pools so every species gets a comparable sample.
     * The pools are uneven — 50 standard and 50 rare against 10 mythic — so a
     * flat single seed gave a mythic species NINE games. At that count a win
     * rate is quantised to 11% steps and the per-species band measures noise,
     * not balance: Solar Stag read 11.1% (one win) and tripped the hard floor
     * while the 63-game analyzer had it at 27%. */
    const MIN_GAMES_PER_SPECIES = 40;
    const seedsFor = (poolSize: number) => Math.max(1, Math.ceil(MIN_GAMES_PER_SPECIES / Math.max(1, poolSize - 1)));

    for (const [, list] of byRarity) {
        const seedsHere = seedsFor(list.length);
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              for (let sd = 0; sd < seedsHere; sd++) {
                const seed = 1_000_003 * (i * 251 + j) + 17 + sd * 7919;
                const [A, B] = (i + j + sd) % 2 === 0 ? [list[i], list[j]] : [list[j], list[i]];
                const { won, rounds, judged } = fight(A, B, seed);
                totalGames += 1; totalRounds += rounds;
                unresolvedGames += rounds >= HARD_STOP ? 1 : 0;
                judgedGames += judged ? 1 : 0;
                for (const [tpl, w] of [[A, won], [B, !won]] as const) {
                    bump(roleStats, String(tpl.role ?? 'none'), w);
                    bump(elementStats, String(tpl.element ?? 'None'), w);
                    bump(speciesStats, String(tpl.name ?? tpl.id), w);
                }
              }
            }
        }
    }

    assert.ok(totalGames > 2000, `slice ran ${totalGames} games`);
    const failures: string[] = [];
    const pct = (s: { w: number; n: number }) => 100 * s.w / Math.max(1, s.n);
    for (const [role, s] of roleStats) {
        if (pct(s) < 35 || pct(s) > 65) failures.push(`role ${role} at ${pct(s).toFixed(1)}%`);
    }
    for (const [el, s] of elementStats) {
        if (pct(s) < 35 || pct(s) > 65) failures.push(`element ${el} at ${pct(s).toFixed(1)}%`);
    }
    // Pace band for the THREE-pet shape. The old 5.5-11.5 described a single
    // fighter with no reserves; three pets a side legitimately take about three
    // times as long, which is where VGC-style team battles sit.
    const avgRounds = totalRounds / totalGames;
    if (avgRounds < 13 || avgRounds > 26) failures.push(`avg rounds ${avgRounds.toFixed(1)} outside 13-26`);
    // THE ONE THAT MATTERS MOST: a match should be won, not awarded. At the old
    // damage pacing (tuned for a one-pet fight) 51.9% of three-pet matches ran
    // out the clock and were settled by the judge.
    const judgedPct = 100 * judgedGames / totalGames;
    if (judgedPct > 20) failures.push(`${judgedPct.toFixed(1)}% of matches decided by the round-cap judge (budget 20%)`);
    if (unresolvedGames / totalGames > 0.3) failures.push(`hard-stop leaves unresolved ${(100 * unresolvedGames / totalGames).toFixed(1)}% of games`);

    // SPECIES spread — the band nothing used to gate, on the tier nothing used
    // to simulate. This is the one a player actually feels: if the pet you pull
    // decides the fight before you press anything, the mode is a slot machine.
    //
    // Two thresholds, deliberately different in kind:
    //  - a HARD floor/ceiling no species may ever cross, and
    //  - a RATCHET on how many may sit outside the comfortable band, set just
    //    above the measured count so it can only be tightened, never drifted.
    // Lower COMFORT_BUDGET when a rebalance earns it; never raise it to make a
    // regression pass.
    const HARD_LO = 15, HARD_HI = 85;
    const COMFORT_LO = 25, COMFORT_HI = 75;
    // Ratcheted 14 -> 8 -> 7 across three passes. The 2026-08-14 bench rebalance
    // (pivot for assassins, re-fitted ROLE/ELEMENT damage, and the mode's real
    // three-pet shape) measures SIX outside comfort on this slice; budget sits
    // one above so sampling jitter does not flap CI.
    //
    // It was briefly set to 5, measured while sages derived `barrier` during a
    // tuning sweep. That configuration was reverted — sages derive WEATHER,
    // which is the only source of weather in the game — so 5 described a build
    // that never shipped. Seven is the honest number for the one that did, and
    // still a ratchet DOWN from 8. Lower it when a rebalance earns it; never
    // raise it to make a regression pass.
    const COMFORT_BUDGET = 7;
    let outsideComfort = 0;
    for (const [name, st] of speciesStats) {
        const p = pct(st);
        if (p < HARD_LO || p > HARD_HI) failures.push(`species ${name} at ${p.toFixed(1)}% (outside ${HARD_LO}-${HARD_HI})`);
        if (p < COMFORT_LO || p > COMFORT_HI) outsideComfort += 1;
    }
    if (outsideComfort > COMFORT_BUDGET) {
        failures.push(`${outsideComfort} species outside ${COMFORT_LO}-${COMFORT_HI}% (budget ${COMFORT_BUDGET})`);
    }

    assert.deepEqual(failures, [], `balance bands violated — retune api/_pet-showdown/engine.ts (see scripts/showdown-balance.mjs):\n${failures.join('\n')}`);
});
