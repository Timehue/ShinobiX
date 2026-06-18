import { test } from 'node:test';
import assert from 'node:assert/strict';
import { softResetRating, leaderboard, rewardPodium, nextSeason, computeRewards, SEASON_LENGTH_MS, PODIUM_AURA_STONES, type LadderEntry } from './_ranked-season.js';

test('softResetRating pulls halfway to 1000', () => {
    assert.equal(softResetRating(1000), 1000);
    assert.equal(softResetRating(1400), 1200);
    assert.equal(softResetRating(600), 800);
    assert.equal(softResetRating(2000), 1500);
    assert.equal(softResetRating(0), 500);
    // missing / non-numeric → treated as the default, so no change
    assert.equal(softResetRating(undefined), 1000);
    assert.equal(softResetRating('abc'), 1000);
    // never goes negative
    assert.ok(softResetRating(-5000) >= 0);
});

const E = (slug: string, rating: number): LadderEntry => ({ slug, name: slug, rating });

test('leaderboard sorts by rating desc, ranks, caps at n', () => {
    const lb = leaderboard([E('a', 1100), E('b', 1500), E('c', 900), E('d', 1300)], 3);
    assert.deepEqual(lb.map((e) => e.slug), ['b', 'd', 'a']);
    assert.deepEqual(lb.map((e) => e.rank), [1, 2, 3]);
});

test('rewardPodium only includes players above the default', () => {
    const pod = rewardPodium([E('won', 1400), E('even', 1000), E('lost', 800), E('mid', 1100)]);
    assert.deepEqual(pod.map((e) => e.slug), ['won', 'mid']); // 1000 and 800 excluded
    assert.deepEqual(pod.map((e) => e.rank), [1, 2]);
});

test('rewardPodium caps at 3', () => {
    const pod = rewardPodium([E('a', 1500), E('b', 1400), E('c', 1300), E('d', 1200)]);
    assert.equal(pod.length, 3);
});

test('nextSeason increments id and chains the window', () => {
    const now = 1_000_000_000_000;
    const cur = { id: 3, startedAt: now - SEASON_LENGTH_MS, endsAt: now - 1000 };
    const next = nextSeason(cur, now);
    assert.equal(next.id, 4);
    assert.equal(next.startedAt, cur.endsAt); // chains from the old end
    assert.equal(next.endsAt, cur.endsAt + SEASON_LENGTH_MS);
});

test('nextSeason from null starts season 1', () => {
    const next = nextSeason(null, 5000);
    assert.equal(next.id, 1);
    assert.equal(next.startedAt, 5000);
});

test('computeRewards: champion gets relic + top aura; runners-up get aura only', () => {
    const playerPod = [
        { slug: 'champ', name: 'champ', rating: 1500, rank: 1 },
        { slug: 'second', name: 'second', rating: 1300, rank: 2 },
        { slug: 'third', name: 'third', rating: 1100, rank: 3 },
    ];
    const rewards = computeRewards(playerPod, []);
    assert.deepEqual(rewards.get('champ'), { auraStones: PODIUM_AURA_STONES[0], relics: 1, championOf: ['player'] });
    assert.deepEqual(rewards.get('second'), { auraStones: PODIUM_AURA_STONES[1], relics: 0, championOf: [] });
    assert.deepEqual(rewards.get('third'), { auraStones: PODIUM_AURA_STONES[2], relics: 0, championOf: [] });
});

test('computeRewards: winning both ladders aggregates relics + aura', () => {
    const top = (slug: string) => [{ slug, name: slug, rating: 1500, rank: 1 }];
    const rewards = computeRewards(top('ace'), top('ace'));
    const r = rewards.get('ace');
    assert.equal(r?.relics, 2);
    assert.equal(r?.auraStones, PODIUM_AURA_STONES[0] * 2);
    assert.deepEqual(r?.championOf, ['player', 'pet']);
});
