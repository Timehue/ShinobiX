import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerGaitTilesPerSecond, sectorGaitTilesPerSecond } from './sector-gait-rates';
import { WORLD_WALK_SPEED } from '../api/_realtime/world-movement';

test('players move faster than the authored NPC stroll but stay under the server movement cap', () => {
    for (const gait of ['walk', 'run'] as const) {
        assert.ok(playerGaitTilesPerSecond[gait] > sectorGaitTilesPerSecond[gait]);
        assert.ok(WORLD_WALK_SPEED - playerGaitTilesPerSecond[gait] >= 1.5, `${gait} leaves at least 1.5 tiles/s for network jitter`);
    }
    assert.ok(Math.abs(playerGaitTilesPerSecond.walk - 31 / 15) < 1e-9);
    assert.equal(playerGaitTilesPerSecond.run, 5);
    assert.ok(playerGaitTilesPerSecond.run > playerGaitTilesPerSecond.walk * 2);
});
