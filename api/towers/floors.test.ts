import assert from 'node:assert/strict';
import test from 'node:test';
import { FLOOR_CATALOG } from './_floor-catalog.js';
import { publicTowerFloorMeta } from './floors.js';

test('public Tower floor metadata previews rewards and authored tactical warnings without stats', () => {
    const crossfire = publicTowerFloorMeta(FLOOR_CATALOG[1]!);
    assert.deepEqual(crossfire.reinforcementWaves, [2]);
    assert.equal(crossfire.fieldRule?.kind, 'buff');
    assert.equal(crossfire.enemyCount, 9);
    assert.equal(crossfire.phaseReinforcementCount, 0);
    assert.equal(crossfire.chapterTitle, 'The Spire Ascent');
    assert.equal(crossfire.artKey, 'crossfire-glade');
    assert.equal(crossfire.briefing?.tactics.length, 3);
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
    assert.equal(publicTowerFloorMeta(floor(9)).phaseReinforcementCount, 6, 'both Ravager gates preview three reinforcements');
});

test('Chapter 2 public metadata carries the sealed arc briefing without exposing combat stats', () => {
    const floor = (id: number) => publicTowerFloorMeta(FLOOR_CATALOG.find(candidate => candidate.id === id)!);
    const breach = floor(11);
    assert.equal(breach.chapter, 2);
    assert.equal(breach.chapterTitle, 'The Stormglass Rebellion');
    assert.equal(breach.artKey, 'stormglass-breach');
    assert.deepEqual(breach.reinforcementWaves, [2, 4]);
    assert.equal(breach.briefing?.tactics.length, 3);
    assert.equal('enemies' in breach, false);
    assert.equal('boss' in breach, false);

    const archive = floor(12);
    assert.equal(archive.objective, 'break-objective');
    assert.equal(archive.bossMechanic, 'bulwark');
    assert.deepEqual(archive.bossStrike, { kind: 'volley', everyRounds: 3, firstRound: 3, radius: 1 });

    const crown = floor(15);
    assert.equal(crown.objective, 'kill-adds-first');
    assert.equal(crown.bossMechanic, 'summon');
    assert.equal(crown.phaseReinforcementCount, 4);
    assert.equal(crown.milestone, 'tower-floor-15');
    assert.deepEqual(crown.closingRing, { fromRound: 11, minRadius: 3, percent: 3 });
    assert.deepEqual(crown.firstClearReward, {
        ryo: 9000,
        statPoints: 90,
        fateShards: 45,
        boneCharms: 15,
        milestone: 'tower-floor-15',
    });
});
