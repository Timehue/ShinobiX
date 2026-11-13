import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerGaitTilesPerSecond, sectorGaitTilesPerSecond } from './sector-gait-rates';
import { WORLD_WALK_SPEED } from '../api/_realtime/world-movement';

test('players move faster than the authored NPC stroll but stay under the server movement cap', () => {
    for (const gait of ['walk', 'run'] as const) {
        assert.ok(playerGaitTilesPerSecond[gait] > sectorGaitTilesPerSecond[gait]);
        assert.ok(playerGaitTilesPerSecond[gait] < WORLD_WALK_SPEED * .75, `${gait} leaves room for network jitter`);
    }
    assert.ok(playerGaitTilesPerSecond.walk >= 1, 'a walk crosses a sector in about twelve seconds or less');
    assert.ok(playerGaitTilesPerSecond.run > playerGaitTilesPerSecond.walk * 2);
});
