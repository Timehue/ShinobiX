import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { simFloor } from './spire-balance-sim.js';

// Re-baselined 2026-10-05 (owner's call). Boss ground zones used to do nothing to the
// squad: their pulse was applied at round end and aged away before anyone acted, and the
// zone expired a round early. Now they reach the squad for two turns, as the tooltip and
// PvP say (api/towers/_engine.ts layGroundZone). That alone moved the sim's floors with zone
// bosses (F9 Soul Mist, F10 Starless Rift, F12 Ion Prison, F15-F20); every other floor is
// unchanged. Measured then: F8-12 79-92% (75% on some blessing weeks), F13-17 46-79%,
// F18-20 13-50%.
const TARGETS = [
    { minFloor: 8, maxFloor: 12, minWin: 72, maxWin: 95 },
    { minFloor: 13, maxFloor: 17, minWin: 40, maxWin: 80 },
    { minFloor: 18, maxFloor: 20, minWin: 10, maxWin: 55 },
] as const;

describe('Endless Spire release balance', () => {
    it('covers the seven early ascension tiers omitted by the late-game release bands', () => {
        for (let floor = 1; floor <= 7; floor++) {
            const result = simFloor(floor, 4, 12);
            assert.ok(result.win >= 80, `F${floor} early-tier win rate ${result.win}% should remain approachable`);
            assert.ok(result.avgRounds > 0, `F${floor} produces completed wins rather than a stalled simulation`);
        }
    });

    it('keeps the geared four-player win curve inside the release bands', () => {
        for (const target of TARGETS) {
            for (let floor = target.minFloor; floor <= target.maxFloor; floor++) {
                const result = simFloor(floor, 4, 24);
                assert.ok(
                    result.win >= target.minWin && result.win <= target.maxWin,
                    `F${floor} win rate ${result.win}% left [${target.minWin}%, ${target.maxWin}%] `
                    + `(rounds ${result.avgRounds}, loss ${result.failCause || 'none'}, boss ${result.bossLeft}% left)`,
                );
            }
        }
    });

    it('keeps every rotating weekly blessing inside the release bands', () => {
        for (let blessingWeek = 0; blessingWeek < 5; blessingWeek++) {
            for (const target of TARGETS) {
                for (let floor = target.minFloor; floor <= target.maxFloor; floor++) {
                    const result = simFloor(floor, 4, 16, { blessingWeek });
                    assert.ok(
                        result.win >= target.minWin && result.win <= target.maxWin,
                        `F${floor} blessing week ${blessingWeek} win rate ${result.win}% `
                        + `left [${target.minWin}%, ${target.maxWin}%]`,
                    );
                }
            }
        }
    });
});
