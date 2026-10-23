import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WILD_HIT_CEILING } from './_encounter.js';
import { sectorExplorePostChestRates } from '../world/_explore.js';

/*
 * The Explore outcome table (api/world/_explore.ts) lands exactly on its
 * authored shares only if it is sized against the real wild-pet probe that
 * runs before it. The probe used to be a literal 0.95 survival there; the
 * 2026-10 rebalance widened the rare band (hit ceiling 5% -> 5.9%), so the
 * survival must follow WILD_HIT_CEILING or every later Explore outcome drifts
 * (gather would read 19.8% instead of 20%).
 */
test('the Explore table is sized against the wild-pet hit ceiling', () => {
    for (const level of [1, 49]) {
        assert.ok(Math.abs(sectorExplorePostChestRates(level, false).survival - (1 - WILD_HIT_CEILING)) < 1e-12, `level ${level}`);
    }
    for (const level of [50, 100]) {
        // The level-50 dungeon probe (2%) runs first.
        assert.ok(Math.abs(sectorExplorePostChestRates(level, false).survival - 0.98 * (1 - WILD_HIT_CEILING)) < 1e-12, `level ${level}`);
    }
});

test('a gather keeps its authored 20% of all Explores once the pet probe is accounted for', () => {
    for (const level of [1, 50]) for (const chest of [true, false]) {
        const rates = sectorExplorePostChestRates(level, chest);
        const dungeon = level >= 50 ? 0.02 : 0;
        const reachesPetProbe = 1 - dungeon;
        const reachesChest = reachesPetProbe * (1 - WILD_HIT_CEILING);
        const reachesTail = reachesChest * (chest ? 0.85 : 1);
        assert.ok(Math.abs(reachesTail * rates.gather - 0.20) < 1e-12, `level ${level}, chests ${chest}`);
    }
});
