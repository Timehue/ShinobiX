/*
 * Parity guard: the server's PvE difficulty layer (api/_pve-difficulty.ts) MUST
 * match the client's (shinobij.client/src/lib/pve-difficulty.ts).
 *
 * This layer decides whether a new player's first fight is survivable, so a
 * silent divergence here is a launch-grade bug that no test elsewhere would
 * catch. The sweep covers every band boundary and, for the hit guard, a grid
 * over the inputs that actually interact (band × HP × turn-start HP × damage
 * already dealt) — the mercy floor only shows up at specific combinations, so
 * spot checks would miss it.
 *
 * Lives in scripts/ — excluded from both build roots — like the other
 * cross-build-root parity tests.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// Client (source of truth)
import {
    pveAiCompetence as clientCompetence,
    pveAiMasteryForLevel as clientMastery,
    pveDifficultyBand as clientBand,
    pveDifficultyHpMultiplier as clientHpMult,
    pveDifficultyStatMultiplier as clientStatMult,
    pveEasyBandAllowsLethal as clientAllowsLethal,
    pveEasyBandHoldsBurst as clientHoldsBurst,
    pveEnemyHitCap as clientHitCap,
    pveGuardedEnemyHit as clientGuardedHit,
    pveIsBurstJutsuAp as clientIsBurst,
    scaleStatsForPveDifficulty as clientScaleStats,
} from '../shinobij.client/src/lib/pve-difficulty';
import type { Stats } from '../shinobij.client/src/types/combat';

// Server (the port under test)
import {
    pveAiCompetence,
    pveAiMasteryForLevel,
    pveDifficultyBand,
    pveDifficultyHpMultiplier,
    pveDifficultyStatMultiplier,
    pveEasyBandAllowsLethal,
    pveEasyBandHoldsBurst,
    pveEnemyHitCap,
    pveGuardedEnemyHit,
    pveIsBurstJutsuAp,
    scaleStatsForPveDifficulty,
} from '../api/_pve-difficulty';

// Every level plus the junk values the callers can actually pass.
const LEVELS = [
    ...Array.from({ length: 100 }, (_, i) => i + 1),
    0, -1, 101, 150, Number.NaN,
];

describe('PvE difficulty parity (server ⇄ client)', () => {
    it('band, stat multiplier and HP multiplier match at every level', () => {
        for (const level of LEVELS) {
            assert.equal(pveDifficultyBand(level), clientBand(level), `band @ ${level}`);
            assert.equal(pveDifficultyStatMultiplier(level), clientStatMult(level), `stat mult @ ${level}`);
            assert.equal(pveDifficultyHpMultiplier(level), clientHpMult(level), `hp mult @ ${level}`);
        }
    });

    it('band boundaries are exactly 30/50/90', () => {
        // Pinned explicitly: an off-by-one here silently re-tunes a whole band.
        for (const [level, band] of [[30, 'easy'], [31, 'medium'], [50, 'medium'], [51, 'hard'], [90, 'hard'], [91, 'peer']] as const) {
            assert.equal(pveDifficultyBand(level), band, `level ${level}`);
            assert.equal(clientBand(level), band, `client level ${level}`);
        }
    });

    it('AI mastery matches at every level', () => {
        for (const level of LEVELS) {
            assert.equal(pveAiMasteryForLevel(level), clientMastery(level), `mastery @ ${level}`);
        }
    });

    it('enemy hit cap matches across levels × player HP', () => {
        for (const level of LEVELS) {
            for (const maxHp of [1, 300, 500, 1_000, 3_000, 10_000, Number.NaN]) {
                assert.equal(pveEnemyHitCap(level, maxHp), clientHitCap(level, maxHp), `cap @ L${level} hp${maxHp}`);
            }
        }
    });

    // The important one: the full guard, over the input grid where the per-hit
    // cap, per-turn cap and mercy floor actually interact.
    it('the enemy hit guard matches over the whole interacting input grid', () => {
        const levels = [1, 5, 10, 11, 20, 30, 31, 45, 50, 51, 70, 90, 91, 100];
        const maxHps = [300, 1_000, 10_000];
        const rawHits = [0, 1, 50, 250, 999, 5_000, 99_999];
        let compared = 0;
        for (const enemyLevel of levels) {
            for (const playerMaxHp of maxHps) {
                for (const startFrac of [0, 0.1, 0.24, 0.25, 0.4, 0.5, 0.51, 0.9, 1]) {
                    const playerHpTurnStart = Math.floor(playerMaxHp * startFrac);
                    for (const dealtThisTurn of [0, 100, 1_000]) {
                        for (const rawHit of rawHits) {
                            const guard = { enemyLevel, playerMaxHp, playerHpTurnStart, dealtThisTurn };
                            assert.equal(
                                pveGuardedEnemyHit(rawHit, guard),
                                clientGuardedHit(rawHit, guard),
                                `guard L${enemyLevel} hp${playerMaxHp} start${playerHpTurnStart} dealt${dealtThisTurn} raw${rawHit}`,
                            );
                            compared++;
                        }
                    }
                }
            }
        }
        assert.ok(compared > 5_000, `expected a broad sweep, only compared ${compared}`);
    });

    it('the easy band really cannot kill a healthy player', () => {
        // The behavioural guarantee the port exists to preserve, asserted
        // directly rather than only via parity — if BOTH sides ever regress,
        // parity would still pass but onboarding would be broken.
        const playerMaxHp = 1_000;
        for (const enemyLevel of [1, 5, 10, 20, 30]) {
            const survived = pveGuardedEnemyHit(99_999, {
                enemyLevel, playerMaxHp, playerHpTurnStart: playerMaxHp, dealtThisTurn: 0,
            });
            assert.ok(survived < playerMaxHp, `L${enemyLevel} must not one-shot a full-HP player (dealt ${survived})`);
        }
        // Peer band is uncapped on purpose — endgame PvE hits like a real duel.
        assert.equal(pveGuardedEnemyHit(99_999, { enemyLevel: 100, playerMaxHp, playerHpTurnStart: playerMaxHp, dealtThisTurn: 0 }), 99_999);
    });

    it('behaviour pacing helpers match', () => {
        for (const ap of [0, 30, 40, 59, 60, 100]) {
            assert.equal(pveIsBurstJutsuAp(ap), clientIsBurst(ap), `burst ap ${ap}`);
        }
        for (const level of [1, 15, 30, 31, 60, 95]) {
            for (const turn of [1, 2, 3, 4, 10]) {
                assert.equal(pveEasyBandHoldsBurst(level, turn), clientHoldsBurst(level, turn), `hold L${level} t${turn}`);
            }
            for (const frac of [0, 0.1, 0.25, 0.26, 0.5, 1]) {
                assert.equal(pveEasyBandAllowsLethal(level, frac), clientAllowsLethal(level, frac), `lethal L${level} f${frac}`);
            }
        }
    });

    it('the competence ladder matches, including the masterAi override', () => {
        for (const level of LEVELS) {
            for (const master of [false, true]) {
                assert.deepEqual(pveAiCompetence(level, master), clientCompetence(level, master), `competence L${level} master=${master}`);
            }
        }
    });

    it('stat scaling matches, and a factor of 1 is identity', () => {
        const stats = {
            strength: 300, speed: 420, intelligence: 610, willpower: 380,
            bukijutsuOffense: 180, bukijutsuDefense: 140,
            taijutsuOffense: 200, taijutsuDefense: 150,
            genjutsuOffense: 1700, genjutsuDefense: 1200,
            ninjutsuOffense: 900, ninjutsuDefense: 700,
        } as Stats;
        for (const factor of [0.6, 0.75, 0.9, 1.0, 1.5, 0]) {
            assert.deepEqual(
                scaleStatsForPveDifficulty({ ...stats }, factor),
                clientScaleStats({ ...stats }, factor),
                `factor ${factor}`,
            );
        }
        const same = { ...stats };
        assert.equal(scaleStatsForPveDifficulty(same, 1), same, 'factor 1 returns the same object');
    });
});
