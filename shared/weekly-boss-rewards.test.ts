import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WEEKLY_BOSS_MVP_RYO_CAP,
    WEEKLY_BOSS_PLAYER_RYO_CAP,
    WEEKLY_BOSS_REWARD_DEFAULTS,
    WEEKLY_BOSS_REWARD_REF_HP,
    weeklyBossRyoReward,
    weeklyBossRyoRewardDetail,
} from './weekly-boss-rewards.js';

test('the reward reference and caps are the owner values (framework #13, amendment A5)', () => {
    assert.equal(WEEKLY_BOSS_REWARD_REF_HP, 100_000);
    assert.equal(WEEKLY_BOSS_PLAYER_RYO_CAP, 60_000);
    assert.equal(WEEKLY_BOSS_MVP_RYO_CAP, 90_000);
    assert.deepEqual({ ...WEEKLY_BOSS_REWARD_DEFAULTS }, { refHp: 100_000, playerCap: 60_000, mvpCap: 90_000 });
});

test('shares below the caps pay the old formula on the fixed reference', () => {
    assert.equal(weeklyBossRyoReward(0.15, false), 10_587, 'a regular 15% share');
    assert.equal(weeklyBossRyoReward(0.1, false), 7_150, 'one of ten equal contributors');
    assert.equal(weeklyBossRyoReward(0.1, true), 14_025, 'the MVP of ten equal contributors');
    assert.equal(weeklyBossRyoReward(0.35, true), 48_400, 'a hardcore 35% MVP is under the 90,000 cap');
    assert.equal(weeklyBossRyoReward(0.5, false), 34_650, 'the largest share a non-MVP can hold');
});

test('a share of 0 still pays the two floors', () => {
    assert.equal(weeklyBossRyoReward(0, false), 275);
    assert.equal(weeklyBossRyoReward(0, true), 275);
});

test('the caps clip the payout and burn the excess', () => {
    assert.deepEqual(weeklyBossRyoRewardDetail(1, true), { ryo: 90_000, raw: 137_775, cappedAt: 90_000 }, 'a solo MVP');
    assert.deepEqual(weeklyBossRyoRewardDetail(0.66, true), { ryo: 90_000, raw: 91_025, cappedAt: 90_000 });
    assert.deepEqual(weeklyBossRyoRewardDetail(0.65, true), { ryo: 89_650, raw: 89_650 }, 'just under the MVP cap');
    // A non-MVP can hold at most half the damage, so at the default reference
    // the 60,000 cap cannot bind; it guards a raised WB_REWARD_REF_HP.
    assert.deepEqual(weeklyBossRyoRewardDetail(1, false), { ryo: 60_000, raw: 69_025, cappedAt: 60_000 });
    assert.deepEqual(weeklyBossRyoRewardDetail(0.5, false, { refHp: 200_000, playerCap: 60_000, mvpCap: 90_000 }),
        { ryo: 60_000, raw: 69_025, cappedAt: 60_000 });
});

test('no share pays above its cap, and pay never falls as the share rises', () => {
    for (const isMvp of [false, true]) {
        let prior = 0;
        for (let i = 0; i <= 1000; i++) {
            const ryo = weeklyBossRyoReward(i / 1000, isMvp);
            assert.ok(ryo <= (isMvp ? WEEKLY_BOSS_MVP_RYO_CAP : WEEKLY_BOSS_PLAYER_RYO_CAP), `share ${i / 1000} pays ${ryo}`);
            assert.ok(ryo >= prior, `share ${i / 1000} pays less than the share before it`);
            prior = ryo;
        }
    }
});

test('a garbage share is treated as 0 and an out-of-range share is clamped', () => {
    assert.equal(weeklyBossRyoReward(Number.NaN, true), 275);
    assert.equal(weeklyBossRyoReward(-3, false), 275);
    assert.equal(weeklyBossRyoReward(7, true), 90_000);
});
