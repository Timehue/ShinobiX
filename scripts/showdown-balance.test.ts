/*
 * Pet Showdown balance ratchet — CI guard for the tuning constants in
 * api/_pet-showdown/engine.ts (DAMAGE_SCALE, ROLE_DAMAGE_MULT,
 * ELEMENT_DAMAGE/TAKEN_MULT, the species budget normalization) and the wheel
 * constants in shared/pet-showdown-contract.ts.
 *
 * Runs a REDUCED slice of scripts/showdown-balance.mjs (every rarity, 1 seed —
 * fully deterministic) so the suite stays fast; the full 3-seed sweep lives in
 * the analyzer script for tuning sessions. Bands carry sampling slack — a
 * change that pushes a ROLE or ELEMENT outside 35-65 on this slice, stalls the
 * pace, breaches the per-species bands, or leaves fights unresolved at the
 * sim's hard stop is a balance regression, not noise.
 *
 * Modeled on scripts/pet-role-balance.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.js';
import { chooseShowdownAiCommands } from '../api/_pet-showdown/ai.js';
const HARD_STOP = 400;  // sim-only guard; the engine has no round cap
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
    if (side === 'enemy') return chooseShowdownAiCommands(session);
    const flipped = { ...session, player: session.enemy, enemy: session.player };
    const commands = chooseShowdownAiCommands(flipped);
    session.rng = flipped.rng;
    return commands;
}

function fight(tplA: Record<string, unknown>, tplB: Record<string, unknown>, seed: number) {
    const session = createShowdownSession({
        sessionId: 'ratchet', playerName: 'A', format: '1v1', tier: 'warrior', seed,
        playerPets: [scaled(tplA, 'a')], enemyPets: [scaled(tplB, 'b')], enemyTeamName: 'B',
    });
    let guard = 0;
    while (!session.finished && guard < HARD_STOP + 1) {
        guard += 1;
        const playerCommands = commandsFor(session, 'player');
        const enemyCommands = commandsFor(session, 'enemy');
        resolveShowdownRound(session, playerCommands, enemyCommands);
    }
    return { won: session.outcome === 'win', rounds: session.round };
}

test('showdown balance bands hold across EVERY rarity, chase tiers included', () => {
    const byRarity = new Map<string, Record<string, unknown>[]>();
    for (const tpl of Object.values(PET_CATALOG)) {
        const rarity = String(tpl.rarity);
        if (!RARITIES.has(rarity) || tpl.wildSpawnable === false || !Array.isArray(tpl.jutsus)) continue;
        (byRarity.get(rarity) ?? byRarity.set(rarity, []).get(rarity)!).push(tpl);
    }

    const roleStats = new Map<string, { w: number; n: number }>();
    const elementStats = new Map<string, { w: number; n: number }>();
    const speciesStats = new Map<string, { w: number; n: number }>();
    let totalRounds = 0, totalGames = 0, unresolvedGames = 0;
    const bump = (map: Map<string, { w: number; n: number }>, key: string, won: boolean) => {
        const s = map.get(key) ?? { w: 0, n: 0 };
        s.w += won ? 1 : 0; s.n += 1;
        map.set(key, s);
    };

    for (const [, list] of byRarity) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const seed = 1_000_003 * (i * 251 + j) + 17;
                const [A, B] = (i + j) % 2 === 0 ? [list[i], list[j]] : [list[j], list[i]];
                const { won, rounds } = fight(A, B, seed);
                totalGames += 1; totalRounds += rounds;
                unresolvedGames += rounds >= HARD_STOP ? 1 : 0;
                for (const [tpl, w] of [[A, won], [B, !won]] as const) {
                    bump(roleStats, String(tpl.role ?? 'none'), w);
                    bump(elementStats, String(tpl.element ?? 'None'), w);
                    bump(speciesStats, String(tpl.name ?? tpl.id), w);
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
    const avgRounds = totalRounds / totalGames;
    if (avgRounds < 5.5 || avgRounds > 11.5) failures.push(`avg rounds ${avgRounds.toFixed(1)} outside 5.5-11.5`);
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
    // Ratcheted 14 → 8 after the 2026-08-12 kit surgery (SHOWDOWN_KIT_OVERRIDES
    // for the five legendary outliers). The 3-seed analyzer measures ONE
    // species outside comfort (Armored Polar Bear, 75.9% — its raw budget, not
    // its kit); THIS single-seed slice reads noisier and measured 7, so the
    // budget gates on this file's own instrument with one of head-room.
    // Tighten further when the next surgery earns it, never raise.
    const COMFORT_BUDGET = 8;
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
