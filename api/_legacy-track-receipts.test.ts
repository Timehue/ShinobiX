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
