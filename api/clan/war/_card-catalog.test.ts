import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_CARD_CATALOG } from '../../../shared/chronicle-duel.js';
import { isChronicleProgressionCardId } from '../../card-clash/_progression-cards.js';
import { BUILTIN_CLASH } from './_card-catalog.js';

test('marketplace catalog derives only pack-eligible canonical Chronicle cards', () => {
    const packEligible = CHRONICLE_CARD_CATALOG.filter((card) => !isChronicleProgressionCardId(card.id));
    assert.equal(Object.keys(BUILTIN_CLASH).length, packEligible.length);
    for (const card of packEligible) {
        assert.equal(BUILTIN_CLASH[card.id]?.rarity, card.rarity === 'mythic' ? 'legendary' : card.rarity);
    }
    assert.equal(Object.keys(BUILTIN_CLASH).some((id) => isChronicleProgressionCardId(id)), false);
});
