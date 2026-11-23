import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hasHashedTerm, hasReservedTitleTerm, isAllowedCustomTitle, RESERVED_TITLE_TERM_HASHES } from './_text-moderation.js';
import { KNOWN_EARNED_TITLES, ACHIEVEMENT_TITLES, isKnownEarnedTitle, isServerCreditedTitle, isLegacyOnlyTitle, normalizeTitleKey } from './_titles-registry.js';
import { LEGACY_DEFS } from './_legacy-defs.js';
import { ownsKnownProfileTitle } from './player/_profile-title-ownership.js';
import { ERA_CHAPTERS } from '../shared/era-chapters.js';
import { PLAY_GAMES_REWARD_PRODUCTS } from '../shared/play-games-rewards.js';

test('era chapter titles require server ownership rather than a forged earned list', () => {
    for (const chapter of ERA_CHAPTERS) {
        assert.equal(isKnownEarnedTitle(chapter.rewardTitle), true);
        assert.equal(isServerCreditedTitle(chapter.rewardTitle), true);
        assert.equal(ownsKnownProfileTitle({ earnedTitles: [chapter.rewardTitle] }, chapter.rewardTitle), false);
        assert.equal(ownsKnownProfileTitle({ serverTitles: [chapter.rewardTitle] }, chapter.rewardTitle), true);
    }
});

test('reserved terms catch authority/impersonation, leet + homoglyph + zero-width included', () => {
    for (const bad of [
        'Admin', 'ADMIN', 'admin of pain', 'The Moderator', 'server first',
        'Official Staff', '4dmin', 'Game Master', 'hall of legends',
        'Ádmín',                    // diacritics folded
        'Ad​min',              // zero-width space
        'аdmin',               // Cyrillic 'а'
        'World First',
    ]) {
        assert.equal(hasReservedTitleTerm(bad), true, `should reserve: ${bad}`);
    }
});

// The reserved leader titles from another series are stored as hashes only.
// These tests drive the same matcher with an invented term, so the real words
// never have to be written down here.
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const CANARY_HASHES = new Set([sha256('velmorakage'), sha256('dusk')]);

test('hashed reserved terms match every spelling of the canonical word', () => {
    for (const spelling of [
        'Velmorakage', 'VELMORAKAGE', 'the velmorakage', 'Velmorakage of the Mist',
        'Velmora Kage', 'Velmora-Kage', 'Velmora.Kage', 'velmora_kage', 'Vel-mora-kage',
        'V3lm0rak4ge', 'Velmoraakage', 'Vélmorakage', 'Velm​orakage', 'Vеlmorakage',
        'Velmora Kage?', '"Velmorakage"', '[Velmora:Kage]', 'x Dusk x', 'D.U.S.K',
    ]) {
        assert.equal(hasHashedTerm(spelling, CANARY_HASHES), true, `should match: ${spelling}`);
    }
});

test('hashed reserved terms only match whole words', () => {
    for (const ok of ['Velmora', 'Kage Slayer', 'Velmorakagemusha', 'Duskwalker', 'Velmora the Kage', 'Velmorak Agent', '']) {
        assert.equal(hasHashedTerm(ok, CANARY_HASHES), false, `should not match: ${ok}`);
    }
    assert.equal(hasHashedTerm('Velmorakage', new Set()), false);
});

test('reserved title hashes are pinned so none can silently disappear', () => {
    // Removing a hash from the module must fail here, and the same hashes must
    // also stay guarded by scripts/ip-hygiene.test.mjs. Changing this list is a
    // deliberate act that needs a reason in review.
    assert.deepEqual([...RESERVED_TITLE_TERM_HASHES].sort(), [
        '332cde01112429bacd16b06ef342ac283ab78ca5721260fbc919afad3587765f',
        '379ee033aa10b319a18fd2750715bd1bfc483502e2f251347dc22fdc504e0ce0',
        '9c466412766035c349dd53f9862eeeff9093d5c3c62ba236e209b7f79af372b4',
        '9d05784afac36a2a0499e50a4345ee6fed252d4d964f942404f253935b195c95',
        'eba2ead8ff67d87403ceab1202f451edbd61958c85615a1197f5fdf197d0bc15',
    ]);
    for (const hash of RESERVED_TITLE_TERM_HASHES) assert.match(hash, /^[0-9a-f]{64}$/);
});

test('reserved title hashes are wired into the title gate', () => {
    // Put a canary into the module's own hashed list for the length of this
    // test: the title gate must then refuse it, so the list cannot be
    // disconnected from hasReservedTitleTerm without failing here.
    const live = RESERVED_TITLE_TERM_HASHES as Set<string>;
    const canary = sha256('velmorakage');
    assert.equal(hasReservedTitleTerm('Velmora Kage'), false);
    live.add(canary);
    try {
        assert.equal(hasReservedTitleTerm('Velmora Kage'), true);
        assert.equal(hasReservedTitleTerm('V3lmora-Kage'), true);
        assert.equal(isAllowedCustomTitle('Velmorakage'), false);
    } finally {
        live.delete(canary);
    }
    assert.equal(hasReservedTitleTerm('Velmora Kage'), false);
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
    // 100 base + 100 proven + 100 eternal + achievement and era titles.
    assert.ok(KNOWN_EARNED_TITLES.size >= 320, `registry too small: ${KNOWN_EARNED_TITLES.size}`);
});

test('titles registry covers every legacy + achievement title and flags them', () => {
    assert.equal(ACHIEVEMENT_TITLES.length, 40, 'mirrors TITLE_ACHIEVEMENT_IDS — update both together');
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

test('Play reward titles are registered as strict server-credited titles', () => {
    for (const reward of PLAY_GAMES_REWARD_PRODUCTS.filter((product) => product.kind === 'title')) {
        assert.equal(isKnownEarnedTitle(reward.title), true, `${reward.title} must pass the earned-title registry`);
        assert.equal(isServerCreditedTitle(reward.title), true, `${reward.title} must never trust client-earnedTitles`);
    }
});

test('Play reward titles cannot be equipped through forged client-earnedTitles', () => {
    const title = PLAY_GAMES_REWARD_PRODUCTS[0]!.title;
    assert.equal(ownsKnownProfileTitle({ earnedTitles: [title] }, title), false);
    assert.equal(ownsKnownProfileTitle({ serverTitles: [title] }, title), true);
    assert.equal(ownsKnownProfileTitle({ earnedTitles: ['Season Champion'] }, 'Season Champion'), true);
    assert.equal(ownsKnownProfileTitle({ earnedTitles: ['Season Champion'] }, title), false);
});
