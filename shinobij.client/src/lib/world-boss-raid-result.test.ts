import assert from 'node:assert/strict';
import test from 'node:test';
import { worldBossRaidResult, worldBossRewardLine } from './world-boss-raid-result';

test('clearing a team HP budget does not claim the roaming boss was defeated', () => {
    const result = worldBossRaidResult('squad', { bankedDamage: 28_000, hpRemaining: 547_545 });
    assert.equal(result.title, 'Boss driven back');
    assert.equal(result.objective, 'Raid damage contributed');
    assert.match(result.detail, /shared health remaining/);
    assert.doesNotMatch(worldBossRaidResult('squad').title, /defeated/);
});

test('both return paths can recover the same paid reward from a queue receipt', () => {
    assert.equal(worldBossRewardLine(undefined), '');
    assert.equal(worldBossRewardLine(null), '');
    const text = worldBossRewardLine({ ryo: 2500, statPoints: 3, boneCharms: 2, itemIds: ['weekly-boss-core', 'hunt-titan-bone'], gearDrop: 'sword' });
    assert.match(text, /2,500 Ryo/);
    assert.match(text, /weekly boss core/);
    assert.match(text, /weapon or armor/);
});

test('only a settled zero shared-health receipt announces world victory', () => {
    assert.equal(worldBossRaidResult('squad', { bankedDamage: 100, hpRemaining: 0 }).title, 'World boss defeated');
    assert.equal(worldBossRaidResult('enemy', { bankedDamage: 100, hpRemaining: 500 }).title, 'The raid has ended');
    assert.equal(worldBossRaidResult('enemy', { bankedDamage: 100, hpRemaining: 0 }).title, 'World boss defeated');
});
