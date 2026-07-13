import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { isServerCreditedTitle, isKnownEarnedTitle } from '../_titles-registry.js';

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char | null) => sanitizeCharacterSave(
    { character: incoming }, existing ? { character: existing } : null,
).character as Record<string, unknown>;

const SERVER_TITLE = 'Eternal Duel Sovereign';
const ACH_TITLE = 'Season Champion';
const FREE_TITLE = 'Wandering Blade';

test('title registry still distinguishes strict, earned, and free-text titles', () => {
    assert.equal(isServerCreditedTitle(SERVER_TITLE), true);
    assert.equal(isKnownEarnedTitle(ACH_TITLE), true);
    assert.equal(isServerCreditedTitle(ACH_TITLE), false);
    assert.equal(isKnownEarnedTitle(FREE_TITLE), false);
});

test('generic saves preserve the committed title and paid cosmetics', () => {
    const existing = { customTitle: ACH_TITLE, customTitleStyle: 'ember', customTitleIcon: '⭐', earnedTitles: [ACH_TITLE] };
    const out = sanitize({ customTitle: FREE_TITLE, customTitleStyle: 'royal', customTitleIcon: '🔥' }, existing);
    assert.equal(out.customTitle, ACH_TITLE);
    assert.equal(out.customTitleStyle, 'ember');
    assert.equal(out.customTitleIcon, '⭐');
});

test('incoming ownership proofs cannot authorize a title change', () => {
    const out = sanitize({ customTitle: SERVER_TITLE, legacy: { titles: [SERVER_TITLE] }, serverTitles: [SERVER_TITLE] }, { customTitle: '' });
    assert.equal(out.customTitle, '');
});

test('first save cannot bootstrap a custom title or paid cosmetics', () => {
    const out = sanitize({ customTitle: FREE_TITLE, customTitleStyle: 'ember', customTitleIcon: '⭐' }, null);
    assert.equal(out.customTitle, undefined);
    assert.equal(out.customTitleStyle, undefined);
    assert.equal(out.customTitleIcon, undefined);
});
