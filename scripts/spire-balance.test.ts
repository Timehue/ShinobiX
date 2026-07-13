import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { simFloor } from './spire-balance-sim.js';

const TARGETS = [
    { minFloor: 8, maxFloor: 12, minWin: 82, maxWin: 95 },
    { minFloor: 13, maxFloor: 17, minWin: 55, maxWin: 80 },
    { minFloor: 18, maxFloor: 20, minWin: 20, maxWin: 55 },
] as const;

describe('Endless Spire release balance', () => {
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
