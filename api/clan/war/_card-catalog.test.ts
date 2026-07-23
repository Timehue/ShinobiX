import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_CARD_CATALOG } from '../../../shared/chronicle-duel.js';
import { BUILTIN_CLASH } from './_card-catalog.js';

test('marketplace catalog derives only pack-eligible canonical Chronicle cards', () => {
    const packEligible = CHRONICLE_CARD_CATALOG.filter((card) => !card.id.startsWith('story-') && !card.id.startsWith('legacy-'));
    assert.equal(Object.keys(BUILTIN_CLASH).length, packEligible.length);
    for (const card of packEligible) {
        assert.equal(BUILTIN_CLASH[card.id]?.rarity, card.rarity === 'mythic' ? 'legendary' : card.rarity);
    }
    assert.equal(Object.keys(BUILTIN_CLASH).some((id) => id.startsWith('story-') || id.startsWith('legacy-')), false);
});
