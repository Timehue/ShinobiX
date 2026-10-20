import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyBossRewardConfirmed } from './weekly-boss-reward-presentation';

test('an allocation is not a confirmed payout, including during partial distribution', () => {
    const allocated = { rewardsDistributed: false, distributionSummary: [{ name: 'Aya' }, { name: 'Rin' }] };
    assert.equal(weeklyBossRewardConfirmed(allocated, 'Aya'), false);
    const partial = { ...allocated, creditedPlayers: ['Rin'] };
    assert.equal(weeklyBossRewardConfirmed(partial, 'Aya'), false);
    assert.equal(weeklyBossRewardConfirmed(partial, ' rin '), true);
    assert.equal(weeklyBossRewardConfirmed({ ...partial, creditedPlayers: ['Aya', 'Rin'] }, 'Aya'), true);
});

test('a completed legacy distribution confirms only listed contributors', () => {
    const done = { rewardsDistributed: true, distributionSummary: [{ name: 'Aya' }] };
    assert.equal(weeklyBossRewardConfirmed(done, 'AYA'), true);
    assert.equal(weeklyBossRewardConfirmed(done, 'Ken'), false);
    assert.equal(weeklyBossRewardConfirmed({ rewardsDistributed: true }, 'Aya'), false);
    assert.equal(weeklyBossRewardConfirmed(done, ''), false);
});
