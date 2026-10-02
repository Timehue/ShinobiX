import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appendLegacyActivityReceipt,
    hasLegacyActivityReceipt,
    type LegacyStats,
} from './_legacy-track.js';

test('finite story milestone receipts survive rolling activity eviction', () => {
    const storyReceipt = 'story:run-permanent-001';
    let stats: LegacyStats = appendLegacyActivityReceipt({}, storyReceipt, true);
    for (let index = 0; index < 400; index += 1) {
        stats = appendLegacyActivityReceipt(stats, `card-ai:${index}`);
    }
    assert.equal(stats.activityReceipts?.length, 256);
    assert.equal(hasLegacyActivityReceipt(stats, storyReceipt), true);
    assert.deepEqual(stats.durableActivityReceipts, [storyReceipt]);
});

test('durable and rolling receipt checks share one exact-once gate', () => {
    const stats = appendLegacyActivityReceipt(
        appendLegacyActivityReceipt({}, 'story:run-1', true),
        'pet-ranked:match-1',
    );
    assert.equal(hasLegacyActivityReceipt(stats, 'story:run-1'), true);
    assert.equal(hasLegacyActivityReceipt(stats, 'pet-ranked:match-1'), true);
    assert.equal(hasLegacyActivityReceipt(stats, 'missing'), false);
});

test('recovery receipts expire by day without retiring permanent milestone or war receipts', () => {
    const day = Math.floor(Date.now() / 86_400_000);
    const stats: LegacyStats = { durableActivityReceipts: [
        'story:permanent', 'sector-war:permanent',
        `pvp-recovery:${day - 4}:pvp:expired:winner`,
        `pvp-recovery:${day - 2}:pvp:recoverable:winner`,
    ] };
    const next = appendLegacyActivityReceipt(stats, 'next-mission');
    assert.equal(hasLegacyActivityReceipt(next, 'pvp:expired:winner'), false);
    assert.equal(hasLegacyActivityReceipt(next, 'pvp:recoverable:winner'), true);
    assert.equal(hasLegacyActivityReceipt(next, 'story:permanent'), true);
    assert.equal(hasLegacyActivityReceipt(next, 'sector-war:permanent'), true);
    assert.equal(stats.durableActivityReceipts?.length, 4, 'pruning is immutable');
});
