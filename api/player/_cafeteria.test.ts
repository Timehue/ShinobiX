import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyCafeteriaMeal, cafeteriaMeal, applyCookRecipe, cookMaterialChoiceName, cookMaterialName, cookRecipe } from './_cafeteria.js';

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

describe('_cafeteria - Village Stores cook recipes', () => {
    const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
    it('field rations: 1 beast meat + 30 ryo -> 5 ration-pack (stacked), counter stamped', () => {
        const r = applyCookRecipe({ ryo: 30, itemStacks: [{ itemId: 'hunt-beast-meat', count: 1 }] }, cookRecipe('field-rations')!, NOW);
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.cooked, 5);
        assert.equal(r.dailyCooked, 5);
        assert.equal(r.dailyCap, 40);
        assert.equal(r.character.ryo, 0);
        assert.deepEqual(r.character.itemStacks, [{ itemId: 'ration-pack', count: 5 }]);
        assert.equal(r.character.rationsCookedDate, '2026-08-22');
        assert.equal(r.character.rationsCookedToday, 5);
    });
    it('campaign rations accept frost pelt OR ash scale (80 ryo -> 20)', () => {
        const r = applyCookRecipe({ ryo: 80, inventory: ['hunt-ash-scale'] }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.materialUsed, 'hunt-ash-scale');
        assert.deepEqual(r.character.inventory, []);
        assert.equal(r.cooked, 20);
    });
    it('refuses over the 40/day cap, without ryo, and without a material - and resets on a new UTC day', () => {
        const capped = applyCookRecipe({ ryo: 999, inventory: ['hunt-frost-pelt'], rationsCookedDate: '2026-08-22', rationsCookedToday: 25 }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(capped.ok, false);
        const poor = applyCookRecipe({ ryo: 29, inventory: ['hunt-beast-meat'] }, cookRecipe('field-rations')!, NOW);
        assert.equal(poor.ok, false);
        const bare = applyCookRecipe({ ryo: 999 }, cookRecipe('field-rations')!, NOW);
        assert.equal(bare.ok, false);
        const newDay = applyCookRecipe({ ryo: 999, inventory: ['hunt-frost-pelt'], rationsCookedDate: '2026-08-21', rationsCookedToday: 40 }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(newDay.ok, true);
        assert.equal(cookRecipe('bogus'), null);
    });
    it('a refusal names the materials, never their item ids', () => {
        const bare = applyCookRecipe({ ryo: 999 }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(bare.ok, false);
        if (bare.ok) return;
        assert.equal(bare.error, 'Campaign Rations needs 1 Frost Pelt or Ash Scale.');
        const field = applyCookRecipe({ ryo: 999 }, cookRecipe('field-rations')!, NOW);
        assert.equal(field.ok, false);
        if (field.ok) return;
        assert.equal(field.error, 'Field Rations needs 1 Beast Meat.');
        // no message this endpoint can emit may leak a raw hunt-* id
        for (const message of [bare.error, field.error]) assert.doesNotMatch(message, /hunt-/);
        assert.equal(cookMaterialName('hunt-ash-scale'), 'Ash Scale');
        assert.equal(cookMaterialName('hunt-unknown'), 'hunt-unknown', 'an unmapped id falls back to itself, never undefined');
        assert.equal(cookMaterialChoiceName(cookRecipe('campaign-rations')!), 'Frost Pelt or Ash Scale');
    });
});
