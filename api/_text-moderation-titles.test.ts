import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasReservedTitleTerm, isAllowedCustomTitle } from './_text-moderation.js';
import { KNOWN_EARNED_TITLES, ACHIEVEMENT_TITLES, isKnownEarnedTitle, isServerCreditedTitle, isLegacyOnlyTitle, normalizeTitleKey } from './_titles-registry.js';
import { LEGACY_DEFS } from './_legacy-defs.js';

test('reserved terms catch authority/impersonation, leet + homoglyph + zero-width included', () => {
    for (const bad of [
        'Admin', 'ADMIN', 'admin of pain', 'The Moderator', 'server first',
        'Hokage', 'Official Staff', '4dmin', 'Game Master', 'hall of legends',
        'Ádmín',                    // diacritics folded
        'Ad​min',              // zero-width space
        'аdmin',               // Cyrillic 'а'
        'World First',
    ]) {
        assert.equal(hasReservedTitleTerm(bad), true, `should reserve: ${bad}`);
    }
});

test('game vocabulary and normal titles pass (tightened reserved list)', () => {
    for (const ok of [
        'Shadow of the Leaf', 'Ramen Enthusiast', 'The Unseen Blade',
        'Moonlight Wanderer', 'Big Toad Energy', 'Kagemusha',
        'Kage Slayer',   // "kage" is game vocabulary — no longer reserved
        'Modest Blade',  // "mod" no longer a bare reserved token
        'Devout Monk',   // "dev" no longer reserved
    ]) {
        assert.equal(hasReservedTitleTerm(ok), false, `should allow: ${ok}`);
        assert.equal(isAllowedCustomTitle(ok), true, `should allow: ${ok}`);
    }
    assert.equal(isAllowedCustomTitle(''), true, 'clearing is always allowed');
    assert.equal(isAllowedCustomTitle('x'.repeat(200)), false, 'length cap');
});

test('era trigger titles are server-credited (strict), not just achievement-trusted', () => {
    assert.equal(isServerCreditedTitle('Herald of the Mythic Age'), true, 'era Herald is strict');
    assert.equal(isLegacyOnlyTitle('Herald of the Mythic Age'), false, 'not a legacy title, but still strict');
    assert.equal(isServerCreditedTitle('Moonlit Ghost'), true, 'legacy titles are strict');
    assert.equal(isServerCreditedTitle('Season Champion'), false, 'achievement titles are client-trusted');
    // Whitespace-normalized comparison closes the doubled-space impersonation.
    assert.equal(normalizeTitleKey('Moonlit   Ghost'), 'moonlit ghost');
    assert.equal(isServerCreditedTitle('Moonlit   Ghost'), true, 'doubled space still matched');
});

test('stage 4/5 prestige variants are registered and strict for every legacy', () => {
    assert.equal(isServerCreditedTitle('Proven Moonlit Ghost'), true);
    assert.equal(isServerCreditedTitle('Eternal Moonlit Ghost'), true);
    assert.equal(isKnownEarnedTitle('Proven Duel King'), true);
    for (const d of LEGACY_DEFS) {
        assert.ok(isServerCreditedTitle(`Proven ${d.title}`), `missing proven variant: ${d.title}`);
        assert.ok(isServerCreditedTitle(`Eternal ${d.title}`), `missing eternal variant: ${d.title}`);
    }
    // 100 base + 100 proven + 100 eternal + 22 achievements + era titles.
    assert.ok(KNOWN_EARNED_TITLES.size >= 320, `registry too small: ${KNOWN_EARNED_TITLES.size}`);
});

test('titles registry covers every legacy + achievement title and flags them', () => {
    assert.equal(ACHIEVEMENT_TITLES.length, 26, 'mirrors TITLE_ACHIEVEMENT_IDS — update both together');
    for (const d of LEGACY_DEFS) {
        assert.ok(isKnownEarnedTitle(d.title), `legacy title missing from registry: ${d.title}`);
    }
    assert.ok(isKnownEarnedTitle('Season Champion'));
    assert.ok(isKnownEarnedTitle('  season champion  '), 'case/space-insensitive');
    assert.ok(isKnownEarnedTitle('Herald of the Mythic Age'), 'era trigger title registered');
    assert.equal(isKnownEarnedTitle('Ramen Enthusiast'), false);
    // Registry sanity: base legacy(100) + achievements(22) + era titles at
    // minimum (prestige variants push it past 320 — asserted below).
    assert.ok(KNOWN_EARNED_TITLES.size >= 120, 'legacy(100) + achievements(22) + era titles');
});
