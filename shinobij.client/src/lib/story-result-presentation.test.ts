import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleStoryBossCombat, StorySettlementDeliveryError, type StoryBossSettleResult } from './story-combat-api';
import { storyDeliverySummary, storyRewardSummary } from './story-result-presentation';

const receipt: StoryBossSettleResult = {
    ok: true, progress: 9, xp: 9999, statPoints: 250, ryo: 7500, auraDust: 12, finale: true,
    character: { name: 'Fixture', ryo: 999999 } as StoryBossSettleResult['character'],
    delivery: { battle: 'confirmed', personalReward: 'committed', combatRecord: 'confirmed', legacyRecord: 'pending' },
};

test('reward copy uses receipt grants, omits retired XP, missing grants, zero grants and persistent totals', () => {
    assert.equal(storyRewardSummary(receipt), '+250 stat points · +7,500 ryo · +12 Aura Dust');
    assert.equal(storyRewardSummary({ ...receipt, statPoints: undefined, ryo: 0, auraDust: NaN }), '');
});
test('delivery copy separates pending, unknown and confirmed contributions without a stage claim', () => {
    assert.match(storyDeliverySummary(receipt).join(' '), /pending/);
    assert.deepEqual(storyDeliverySummary({ ...receipt, delivery: undefined }), []);
    const unknown = storyDeliverySummary({ ...receipt, delivery: { ...receipt.delivery!, legacyRecord: 'unavailable' } }).join(' ');
    assert.match(unknown, /unavailable/);
    assert.doesNotMatch(unknown, /pending|advanced|awakened|confirmed/);
    assert.deepEqual(storyDeliverySummary({ ...receipt, delivery: { ...receipt.delivery!, combatRecord: 'unavailable', legacyRecord: 'not-applicable' } }), ['Combat record status unavailable.']);
});
test('partial API response carries the committed reward while preserving retry failure', async () => {
    const prior = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ rewardCommitted: true, settlement: receipt, error: 'Delivery pending' }), { status: 503 });
    try {
        await assert.rejects(settleStoryBossCombat({ playerName: 'Fixture', runId: 'fixture-run' }), error => {
            assert.ok(error instanceof StorySettlementDeliveryError);
            assert.equal(error.settlement.ryo, 7500);
            return true;
        });
        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 });
        await assert.rejects(settleStoryBossCombat({ playerName: 'Fixture', runId: 'fixture-run' }), error => {
            assert.ok(error instanceof Error);
            assert.ok(!(error instanceof StorySettlementDeliveryError));
            return true;
        });
    } finally { globalThis.fetch = prior; }
});
