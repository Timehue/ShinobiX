import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    AWAKENING_FREE_LV2_ID,
    AWAKENING_FREE_LV20_ID,
    AWAKENING_PAID_BOTH_ID,
    AWAKENING_PAID_SINGLE_ID,
    rollAwakening,
} from './_roll.js';

describe('Elemental awakening authority', () => {
    it('grants each level reward once with canonical unique elements', () => {
        const first = rollAwakening({ level: 20, fateShards: 0 }, AWAKENING_FREE_LV2_ID, 'awakening_action_1', () => 0);
        assert.equal(first.ok, true); if (!first.ok) return;
        assert.deepEqual(first.character.elements, ['Water']);
        const second = rollAwakening(first.character, AWAKENING_FREE_LV20_ID, 'awakening_action_2', () => 0);
        assert.equal(second.ok, true); if (!second.ok) return;
        assert.deepEqual(second.character.elements, ['Water', 'Wind']);
    });

    it('charges 10 shards to reroll only the primary element', () => {
        const first = rollAwakening({ level: 20, fateShards: 20, elements: ['Fire', 'Earth'] }, AWAKENING_PAID_SINGLE_ID, 'awakening_action_3', () => 0);
        assert.equal(first.ok, true); if (!first.ok) return;
        assert.equal(first.character.fateShards, 10);
        assert.deepEqual(first.character.elements, ['Water', 'Earth']);
    });

    it('charges 15 shards to reroll both elements and replays safely', () => {
        const first = rollAwakening({ level: 20, fateShards: 20, elements: ['Fire', 'Earth'] }, AWAKENING_PAID_BOTH_ID, 'awakening_action_4', () => 0);
        assert.equal(first.ok, true); if (!first.ok) return;
        assert.equal(first.character.fateShards, 5);
        assert.deepEqual(first.character.elements, ['Water', 'Wind']);
        const replay = rollAwakening(first.character, AWAKENING_PAID_BOTH_ID, 'awakening_action_4', () => 0);
        assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.alreadyApplied, true);
    });

    it('requires two awakened elements for the two-element reroll', () => {
        const result = rollAwakening({ level: 10, fateShards: 20, elements: ['Fire'] }, AWAKENING_PAID_BOTH_ID, 'awakening_action_5', () => 0);
        assert.deepEqual(result, { ok: false, reason: 'second-element-required' });
    });

    it('does not debit either paid option when the balance is too low', () => {
        const single = rollAwakening({ level: 20, fateShards: 9, elements: ['Fire', 'Earth'] }, AWAKENING_PAID_SINGLE_ID, 'awakening_action_6', () => 0);
        const both = rollAwakening({ level: 20, fateShards: 14, elements: ['Fire', 'Earth'] }, AWAKENING_PAID_BOTH_ID, 'awakening_action_7', () => 0);
        assert.deepEqual(single, { ok: false, reason: 'insufficient-fate-shards' });
        assert.deepEqual(both, { ok: false, reason: 'insufficient-fate-shards' });
    });
});
