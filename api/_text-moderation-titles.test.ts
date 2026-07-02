import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasReservedTitleTerm, isAllowedCustomTitle } from './_text-moderation.js';
import { KNOWN_EARNED_TITLES, ACHIEVEMENT_TITLES, isKnownEarnedTitle } from './_titles-registry.js';
import { LEGACY_DEFS } from './_legacy-defs.js';

test('reserved terms catch authority/impersonation, leetspeak included', () => {
    for (const bad of [
        'Admin', 'ADMIN', 'admin of pain', 'The Moderator', 'server first',
        'Hokage', 'kage', 'GM', 'Official Support', 'S3rver F1rst', '4dmin',
        'Game Master', 'hall of legends',
    ]) {
        assert.equal(hasReservedTitleTerm(bad), true, `should reserve: ${bad}`);
    }
});

test('normal player titles pass', () => {
    for (const ok of [
        'Shadow of the Leaf', 'Ramen Enthusiast', 'The Unseen Blade',
        'Moonlight Wanderer', 'Big Toad Energy', 'Kagemusha', // contains "kage" INSIDE a word — boundary rule
    ]) {
        assert.equal(hasReservedTitleTerm(ok), false, `should allow: ${ok}`);
        assert.equal(isAllowedCustomTitle(ok), true, `should allow: ${ok}`);
    }
    assert.equal(isAllowedCustomTitle(''), true, 'clearing is always allowed');
    assert.equal(isAllowedCustomTitle('x'.repeat(200)), false, 'length cap');
});

test('titles registry covers every legacy + achievement title and flags them', () => {
    assert.equal(ACHIEVEMENT_TITLES.length, 22, 'mirrors TITLE_ACHIEVEMENT_IDS — update both together');
    for (const d of LEGACY_DEFS) {
        assert.ok(isKnownEarnedTitle(d.title), `legacy title missing from registry: ${d.title}`);
    }
    assert.ok(isKnownEarnedTitle('Season Champion'));
    assert.ok(isKnownEarnedTitle('  season champion  '), 'case/space-insensitive');
    assert.ok(isKnownEarnedTitle('Herald of the Mythic Age'), 'era trigger title registered');
    assert.equal(isKnownEarnedTitle('Ramen Enthusiast'), false);
    // Registry sanity: no earned title trips the reserved filter EXCEPT via
    // ownership (owned titles bypass it in the sanitizer).
    assert.ok(KNOWN_EARNED_TITLES.size >= 120, 'legacy(100) + achievements(22) + era titles');
});
