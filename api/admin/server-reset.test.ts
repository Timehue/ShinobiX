/*
 * Reset-coverage guard: the full server reset must wipe the story-rebuild
 * keys with the world they belong to. A stale `story:<player>` record would
 * hand a pre-reset player's lane tally and interlude history to whoever
 * re-registers that name; a surviving `hall:nx:kage-first-liberation:*`
 * dedup would make the new era's first liberator seat silently (no
 * announcement, no Hall entry). Protected accounts keep their saves, so
 * they must keep their story records too — wiping one side desyncs them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIPE_PATTERNS, isProtectedKey } from './server-reset.js';

test('full reset wipes story records, announcements, and first-only dedup keys', () => {
    for (const pattern of ['story:*', 'game:announcements', 'game:announcements-seq', 'hall:nx:*', 'village:kage:*']) {
        assert.ok(WIPE_PATTERNS.includes(pattern), `WIPE_PATTERNS must include ${pattern}`);
    }
});

test('protected accounts keep save, auth, AND story record together', () => {
    assert.equal(isProtectedKey('save:rill'), true);
    assert.equal(isProtectedKey('auth:rill'), true);
    assert.equal(isProtectedKey('story:rill'), true);
    // Ordinary players are wiped clean on all three.
    assert.equal(isProtectedKey('save:someplayer'), false);
    assert.equal(isProtectedKey('story:someplayer'), false);
});
