import assert from 'node:assert/strict';
import test from 'node:test';
import { playGamesRewardProduct } from '../../shared/play-games-rewards.js';
import { isPatreonSubscriber, promoSupporterFlag, SUBSCRIBER_TIER } from '../_subscription.js';
import { applyPlayRewardBundle } from './reward-claim.js';

const DAY = 86_400_000;
const NOW = Date.now();
const DIGEST = 'a'.repeat(64);
const box = playGamesRewardProduct('sj_prereg_first_shinobi_box');
assert.ok(box && box.kind === 'bundle');
const BOX = box.contents;

test('the pre-registration box pays 10,000 Ryo, 50 Fate Shards, 10 Bone Charms and 14 Supporter days', () => {
    assert.deepEqual(BOX, { ryo: 10_000, fateShards: 50, boneCharms: 10, supporterDays: 14 });
    const opened = applyPlayRewardBundle({ name: 'raven', ryo: 250, fateShards: 3, boneCharms: 1 }, BOX, DIGEST, NOW);
    assert.ok(opened);
    assert.equal(opened.ryo, 10_250);
    assert.equal(opened.fateShards, 53);
    assert.equal(opened.boneCharms, 11);
    assert.deepEqual(opened.playRewardPurchaseReceipts, [DIGEST]);
    const flag = opened.patreon as Record<string, unknown>;
    assert.equal(flag.tier, SUBSCRIBER_TIER);
    assert.equal(flag.expiresAt, NOW + 14 * DAY);
    assert.equal(flag.userId, '', 'a promo carries no billing reference');
    assert.equal(isPatreonSubscriber(opened), true);
});

test('the same purchase never opens the box twice', () => {
    const once = applyPlayRewardBundle({ ryo: 0 }, BOX, DIGEST, NOW);
    assert.ok(once);
    assert.equal(applyPlayRewardBundle(once, BOX, DIGEST, NOW), null);
});

test('missing or junk wallet values open from zero', () => {
    const opened = applyPlayRewardBundle({ ryo: 'lots', fateShards: -9 }, BOX, DIGEST, NOW);
    assert.ok(opened);
    assert.equal(opened.ryo, 10_000);
    assert.equal(opened.fateShards, 50);
    assert.equal(opened.boneCharms, 10);
});

test('promo days never put an expiry on a paid subscription', () => {
    const paid = { userId: 'tebex-ref', tier: SUBSCRIBER_TIER, active: true, entitledCents: 1500, since: 1 };
    assert.equal(promoSupporterFlag({ patreon: paid }, 14, NOW), null);
    const opened = applyPlayRewardBundle({ patreon: paid }, BOX, DIGEST, NOW);
    assert.deepEqual(opened?.patreon, paid);
});

test('promo days extend a live comp from its expiry', () => {
    const comp = { userId: 'tebex-ref', tier: SUBSCRIBER_TIER, active: true, source: 'admin', expiresAt: NOW + 3 * DAY };
    const flag = promoSupporterFlag({ patreon: comp }, 14, NOW);
    assert.equal(flag?.expiresAt, NOW + 17 * DAY);
    assert.equal(flag?.userId, 'tebex-ref');
    assert.equal(flag?.source, 'admin');
});

test('a lapsed or revoked flag starts a fresh 14-day promo', () => {
    const lapsed = { userId: 'old-ref', tier: SUBSCRIBER_TIER, active: true, source: 'admin', expiresAt: NOW - DAY, since: 5 };
    const fresh = promoSupporterFlag({ patreon: lapsed }, 14, NOW);
    assert.equal(fresh?.expiresAt, NOW + 14 * DAY);
    assert.equal(fresh?.since, NOW);
    assert.equal(fresh?.userId, '');
    assert.equal(fresh?.source, 'promo');
    const revoked = promoSupporterFlag({ patreon: { active: false, tier: 'none' } }, 14, NOW);
    assert.equal(revoked?.active, true);
    assert.equal(promoSupporterFlag({}, 0, NOW), null);
});
