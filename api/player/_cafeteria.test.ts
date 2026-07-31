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

    it('scales meals by percent of max against v2-size pools (flats stay the floor)', () => {
        // 10k HP / 10k chakra / 10k stamina — the combatResourcesV2 endgame. The
        // old flat 25/10/10 ramen was a dead option here; the percent retune
        // (10%/5%/5%) restores 1000/500/500.
        const meal = cafeteriaMeal('small-ramen');
        assert.ok(meal);
        const result = applyCafeteriaMeal({
            ryo: 20, hp: 0, maxHp: 10000, chakra: 0, maxChakra: 10000, stamina: 0, maxStamina: 10000,
        }, meal);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.character.hp, 1000);
        assert.equal(result.character.chakra, 500);
        assert.equal(result.character.stamina, 500);
    });

    it('shinobi meal restores 25%/15%/15% and still caps at max', () => {
        const meal = cafeteriaMeal('shinobi-meal');
        assert.ok(meal);
        const result = applyCafeteriaMeal({
            ryo: 50, hp: 3900, maxHp: 4000, chakra: 1000, maxChakra: 2000, stamina: 0, maxStamina: 2000,
        }, meal);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.character.hp, 4000, 'capped at maxHp');
        assert.equal(result.character.chakra, 1300, '15% of 2000 = 300');
        assert.equal(result.character.stamina, 300);
    });

    it('rejects unaffordable meals without changing the character', () => {
        const meal = cafeteriaMeal('feast');
        assert.ok(meal);
        const result = applyCafeteriaMeal({ ryo: 99, hp: 1, maxHp: 100 }, meal);
        assert.equal(result.ok, false);
    });
});
