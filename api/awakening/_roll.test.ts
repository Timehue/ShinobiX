import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { AWAKENING_FREE_LV2_ID, AWAKENING_FREE_LV20_ID, rollAwakening } from './_roll.js';

describe('Elemental awakening authority', () => {
    it('grants each level reward once with canonical unique elements', () => {
        const first = rollAwakening({ level: 20, fateShards: 0 }, AWAKENING_FREE_LV2_ID, 'awakening_action_1', () => 0);
        assert.equal(first.ok, true); if (!first.ok) return;
        assert.deepEqual(first.character.elements, ['Water']);
        const second = rollAwakening(first.character, AWAKENING_FREE_LV20_ID, 'awakening_action_2', () => 0);
        assert.equal(second.ok, true); if (!second.ok) return;
        assert.deepEqual(second.character.elements, ['Water', 'Wind']);
    });

    it('atomically charges paid rerolls and replays safely', () => {
        const first = rollAwakening({ level: 20, fateShards: 20, elements: ['Fire', 'Earth'] }, 'paid', 'awakening_action_3', () => 0);
        assert.equal(first.ok, true); if (!first.ok) return;
        assert.equal(first.character.fateShards, 10);
        assert.equal(new Set(first.character.elements as string[]).size, 2);
        const replay = rollAwakening(first.character, 'paid', 'awakening_action_3', () => 0);
        assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.alreadyApplied, true);
    });
});
