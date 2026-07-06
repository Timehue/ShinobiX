import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyCafeteriaMeal, cafeteriaMeal } from './_cafeteria.js';

describe('_cafeteria', () => {
    it('applies the small ramen cost and stat restoration', () => {
        const meal = cafeteriaMeal('small-ramen');
        assert.ok(meal);
        const result = applyCafeteriaMeal({
            ryo: 25,
            hp: 10,
            maxHp: 30,
            chakra: 1,
            maxChakra: 9,
            stamina: 2,
            maxStamina: 50,
        }, meal);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.character.ryo, 5);
        assert.equal(result.character.hp, 30);
        assert.equal(result.character.chakra, 9);
        assert.equal(result.character.stamina, 12);
    });

    it('rejects unaffordable meals without changing the character', () => {
        const meal = cafeteriaMeal('feast');
        assert.ok(meal);
        const result = applyCafeteriaMeal({ ryo: 99, hp: 1, maxHp: 100 }, meal);
        assert.equal(result.ok, false);
    });
});
