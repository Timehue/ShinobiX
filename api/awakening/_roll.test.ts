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

describe('a paid awakening reroll always changes the elements', () => {
    const roller = (index: number, seen: number[]) => (max: number) => { seen.push(max); return index; };

    it('a single reroll lands on one of the three elements the player does not hold', () => {
        const primaries = new Set<string>();
        for (let index = 0; index < 3; index++) {
            const seen: number[] = [];
            const result = rollAwakening({ fateShards: 10, elements: ['Fire', 'Earth'] }, AWAKENING_PAID_SINGLE_ID, `awakening_single_${index}`, roller(index, seen));
            assert.equal(result.ok, true); if (!result.ok) return;
            assert.deepEqual(seen, [3]);
            const elements = result.character.elements as string[];
            assert.equal(elements[1], 'Earth', 'the secondary element is kept');
            assert.ok(!['Fire', 'Earth'].includes(elements[0]!), `rolled ${elements[0]}`);
            primaries.add(elements[0]!);
        }
        assert.deepEqual([...primaries].sort(), ['Lightning', 'Water', 'Wind']);
    });

    it('a single reroll with one element draws from the other four', () => {
        const rolled = new Set<string>();
        for (let index = 0; index < 4; index++) {
            const seen: number[] = [];
            const result = rollAwakening({ fateShards: 10, elements: ['Fire'] }, AWAKENING_PAID_SINGLE_ID, `awakening_solo_${index}`, roller(index, seen));
            assert.equal(result.ok, true); if (!result.ok) return;
            assert.deepEqual(seen, [4]);
            assert.notEqual(result.character.element, 'Fire');
            rolled.add(result.character.element as string);
        }
        assert.equal(rolled.size, 4);
    });

    it('the legacy paid kind behaves like the single reroll', () => {
        const seen: number[] = [];
        const result = rollAwakening({ fateShards: 10, elements: ['Water', 'Earth'] }, 'paid', 'awakening_legacy_1', roller(0, seen));
        assert.equal(result.ok, true); if (!result.ok) return;
        assert.deepEqual(seen, [3]);
        assert.deepEqual(result.character.elements, ['Wind', 'Earth']);
        assert.equal(result.character.fateShards, 0);
    });

    it('a two-element reroll draws uniformly from the 18 ordered pairs that are not the held pair', () => {
        const pairs = new Set<string>();
        for (let index = 0; index < 18; index++) {
            const seen: number[] = [];
            const result = rollAwakening({ fateShards: 15, elements: ['Fire', 'Earth'] }, AWAKENING_PAID_BOTH_ID, `awakening_both_${index}`, roller(index, seen));
            assert.equal(result.ok, true); if (!result.ok) return;
            assert.deepEqual(seen, [18]);
            const elements = result.character.elements as string[];
            assert.equal(elements.length, 2);
            assert.notEqual(elements[0], elements[1]);
            assert.notDeepEqual([...elements].sort(), ['Earth', 'Fire'], `index ${index} returned the held pair`);
            pairs.add(elements.join('/'));
        }
        assert.equal(pairs.size, 18);
    });

    it('refuses without a debit or a receipt when there is no new element to roll', () => {
        const all = { fateShards: 50, elements: ['Water', 'Wind', 'Earth', 'Lightning', 'Fire'], redeemedAwakeningActions: [] };
        for (const kind of [AWAKENING_PAID_SINGLE_ID, AWAKENING_PAID_BOTH_ID]) {
            const result = rollAwakening(all, kind, `awakening_full_${kind}`, () => 0);
            assert.deepEqual(result, { ok: false, reason: 'no-new-element' });
        }
        assert.equal(all.fateShards, 50);
        assert.deepEqual(all.redeemedAwakeningActions, []);
    });
});
