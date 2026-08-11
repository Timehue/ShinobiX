import assert from 'node:assert/strict';
import test from 'node:test';
import { FLOOR_CATALOG } from './_floor-catalog.js';
import { publicTowerFloorMeta } from './floors.js';

test('public Tower floor metadata previews rewards and authored tactical warnings without stats', () => {
    const crossfire = publicTowerFloorMeta(FLOOR_CATALOG[1]!);
    assert.deepEqual(crossfire.reinforcementWaves, [2]);
    assert.equal(crossfire.fieldRule?.kind, 'buff');
    assert.equal(crossfire.enemyCount, 9);
    assert.deepEqual(crossfire.firstClearReward, {
        ryo: 600,
        statPoints: 6,
        fateShards: 0,
        boneCharms: 5,
        milestone: null,
    });
    assert.equal('enemies' in crossfire, false, 'enemy stat blocks stay private');
    assert.equal('boss' in crossfire, false, 'boss stat blocks stay private');
});

test('the story boss curve introduces telegraphs and real add-gated objectives in order', () => {
    const floor = (id: number) => FLOOR_CATALOG.find(candidate => candidate.id === id)!;
    assert.equal(floor(5).boss?.strike, undefined, 'the first boss teaches its kit before strike telegraphs');
    assert.equal(floor(7).objective, 'defeat-all-then-boss');
    assert.equal(floor(7).boss?.strike?.kind, 'volley', 'floor seven introduces a targeted warning');
    assert.equal(floor(9).objective, 'kill-adds-first');
    assert.equal(floor(9).boss?.strike?.kind, 'nova', 'floor nine introduces the boss-centered warning');
    assert.equal(floor(10).boss?.strike?.kind, 'nova', 'the finale combines the learned warning with its closing ring');

    const revenant = publicTowerFloorMeta(floor(7));
    assert.deepEqual(revenant.bossStrike, { kind: 'volley', everyRounds: 3, firstRound: 3, radius: 1 });
    assert.equal(revenant.bossTargetMode, 'support');
    const finale = publicTowerFloorMeta(floor(10));
    assert.deepEqual(finale.closingRing, { fromRound: 11, minRadius: 3, percent: 3 });
});
