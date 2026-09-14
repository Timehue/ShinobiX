import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { definitionsFor } from './_state-ownership.js';
import { mergePreservingImages } from '../_utils.js';
import { STORY_RECKONINGS, storyReckoningEligible } from '../sector/_story-reckoning.js';

/*
 * storyVillage picks which village's story arc a character plays, and the
 * server reads it to decide which one-time story reckonings the character may
 * turn in (sector/_story-reckoning.ts). Character creation sets it to the home
 * village and nothing changes it afterwards, so a generic save must not be able
 * to point it at another village.
 */

type Char = Record<string, unknown>;
const wrap = (character: Char) => ({ character });
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave(wrap(incoming), existing ? wrap(existing) : null).character as Record<string, any>;
/** The record the save endpoint persists: sanitized payload merged over stored. */
const persisted = (incoming: Char, existing: Char) =>
    (mergePreservingImages(sanitizeCharacterSave(wrap(incoming), wrap(existing)), wrap(existing)) as { character: Record<string, any> }).character;

const HOME = 'Stormveil Village';
const OTHER = 'Ashen Leaf Village';

test('storyVillage: a later generic save cannot change the stored story village', () => {
    assert.equal(sanitize({ village: HOME, storyVillage: OTHER }, { village: HOME, storyVillage: HOME }).storyVillage, HOME);
});

test('storyVillage: an older save without one falls back to the stored home village, not the requested one', () => {
    assert.equal(sanitize({ village: HOME, storyVillage: OTHER }, { village: HOME }).storyVillage, HOME);
    // Even when the same save also tries to move the home village.
    assert.equal(sanitize({ village: OTHER, storyVillage: OTHER }, { village: HOME }).storyVillage, HOME);
});

test('storyVillage: the first save may only carry the home village', () => {
    assert.equal(sanitize({ village: HOME, storyVillage: OTHER }, null).storyVillage, HOME);
    assert.equal(sanitize({ village: HOME, storyVillage: HOME }, null).storyVillage, HOME);
});

test('storyVillage: a save that omits it is left alone and the stored value survives the write', () => {
    const out = sanitize({ village: HOME }, { village: HOME, storyVillage: HOME });
    assert.equal(Object.prototype.hasOwnProperty.call(out, 'storyVillage'), false, 'nothing is injected');
    assert.equal(persisted({ village: HOME }, { village: HOME, storyVillage: HOME }).storyVillage, HOME);
    // A save that never had one, and never sends one, stays without one.
    assert.equal(Object.prototype.hasOwnProperty.call(sanitize({ village: HOME }, { village: HOME }), 'storyVillage'), false);
});

test('storyVillage: another village\'s one-time reckoning stays closed after a save that tries to switch arcs', () => {
    const otherArc = Object.values(STORY_RECKONINGS).find((def) => def.village === OTHER && def.crossVillage !== true);
    assert.ok(otherArc, `the catalog has an own-village reckoning for ${OTHER}`);
    const stored = { village: HOME, storyVillage: HOME, level: 100, storyProgress: 20, storyTraits: [] };
    // Control: the village is the only thing standing between this character
    // and that reckoning, so the assertion below tests the lock and nothing else.
    assert.equal(storyReckoningEligible({ ...stored, storyVillage: OTHER }, otherArc), true);
    const written = persisted({ ...stored, storyVillage: OTHER }, stored);
    assert.equal(written.storyVillage, HOME);
    assert.equal(storyReckoningEligible(written, otherArc), false);
});

test('storyVillage is classified server-owned in the ownership manifest', () => {
    const defs = definitionsFor('storyVillage').filter((d) => d.scope === 'character');
    assert.equal(defs.length, 1, 'exactly one character-scope entry');
    assert.equal(defs[0].category, 'server-owned');
});
