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
    it('field rations consume meat, herbs, fuel and ryo for five stacked rations', () => {
        const r = applyCookRecipe({ ryo: 30, itemStacks: [{ itemId: 'hunt-beast-meat', count: 1 }, { itemId: 'gather-field-herb', count: 1 }, { itemId: 'gather-heartwood-bark', count: 1 }] }, cookRecipe('field-rations')!, NOW);
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
    it('campaign rations preserve four cuts of meat (80 ryo -> 20), never pelts or scales', () => {
        const r = applyCookRecipe({ ryo: 80, inventory: ['hunt-beast-meat'], itemStacks: [{ itemId: 'hunt-beast-meat', count: 3 }, { itemId: 'gather-field-herb', count: 2 }, { itemId: 'gather-heartwood-bark', count: 2 }] }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.materialUsed, 'hunt-beast-meat');
        assert.deepEqual(r.character.inventory, []);
        assert.equal(r.cooked, 20);
        for (const id of ['hunt-ash-scale', 'hunt-frost-pelt']) {
            assert.equal(applyCookRecipe({ ryo: 80, itemStacks: [{ itemId: id, count: 100 }, { itemId: 'gather-field-herb', count: 2 }] }, cookRecipe('campaign-rations')!, NOW).ok, false);
        }
    });
    it('refuses over the 40/day cap, without ryo, and without a material - and resets on a new UTC day', () => {
        const capped = applyCookRecipe({ ryo: 999, inventory: ['hunt-frost-pelt'], rationsCookedDate: '2026-08-22', rationsCookedToday: 25 }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(capped.ok, false);
        const poor = applyCookRecipe({ ryo: 29, inventory: ['hunt-beast-meat'] }, cookRecipe('field-rations')!, NOW);
        assert.equal(poor.ok, false);
        const bare = applyCookRecipe({ ryo: 999 }, cookRecipe('field-rations')!, NOW);
        assert.equal(bare.ok, false);
        const newDay = applyCookRecipe({ ryo: 999, inventory: Array(4).fill('hunt-beast-meat'), itemStacks: [{ itemId: 'gather-field-herb', count: 2 }, { itemId: 'gather-heartwood-bark', count: 2 }], rationsCookedDate: '2026-08-21', rationsCookedToday: 40 }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(newDay.ok, true);
        assert.equal(cookRecipe('bogus'), null);
    });
    it('missing cooking fuel refuses the whole recipe without spending food, herbs or ryo', () => {
        const base = { ryo: 80, itemStacks: [{ itemId: 'hunt-beast-meat', count: 4 }, { itemId: 'gather-field-herb', count: 2 }, { itemId: 'gather-heartwood-bark', count: 1 }] };
        const before = structuredClone(base);
        const result = applyCookRecipe(base, cookRecipe('campaign-rations')!, NOW);
        assert.deepEqual(result, { ok: false, error: 'Campaign Rations needs 2 Heartwood Bark for cooking fuel (Ember Ore or Ember Scale also burn).', dailyCooked: 0, dailyCap: 40 });
        assert.deepEqual(base, before);
    });
    it('Ember Ore and Ember Scale burn as fuel 1:1, after the bark is spent (item-use pass)', () => {
        const base = { ryo: 80, itemStacks: [
            { itemId: 'hunt-beast-meat', count: 4 }, { itemId: 'gather-field-herb', count: 2 },
            { itemId: 'gather-heartwood-bark', count: 1 }, { itemId: 'gather-ember-ore', count: 3 }, { itemId: 'hunt-ember-scale', count: 2 },
        ] };
        const result = applyCookRecipe(base, cookRecipe('campaign-rations')!, NOW);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        const left = (id: string) => (result.character.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === id)?.count ?? 0;
        assert.equal(left('gather-heartwood-bark'), 0, 'bark burns first');
        assert.equal(left('gather-ember-ore'), 2, 'then one Ember Ore covers the second unit');
        assert.equal(left('hunt-ember-scale'), 2, 'Ember Scale is untouched while ore remains');
        const scalesOnly = applyCookRecipe({ ryo: 30, itemStacks: [{ itemId: 'hunt-beast-meat', count: 1 }, { itemId: 'gather-field-herb', count: 1 }, { itemId: 'hunt-ember-scale', count: 1 }] }, cookRecipe('field-rations')!, NOW);
        assert.equal(scalesOnly.ok, true, 'an Ember Scale alone fuels a batch');
        // Ash Scale is not fuel, so a pile of it still cooks nothing.
        assert.equal(applyCookRecipe({ ryo: 30, itemStacks: [{ itemId: 'hunt-beast-meat', count: 1 }, { itemId: 'gather-field-herb', count: 1 }, { itemId: 'hunt-ash-scale', count: 9 }] }, cookRecipe('field-rations')!, NOW).ok, false);
    });
    it('a refusal names the materials, never their item ids', () => {
        const bare = applyCookRecipe({ ryo: 999 }, cookRecipe('campaign-rations')!, NOW);
        assert.equal(bare.ok, false);
        if (bare.ok) return;
        assert.equal(bare.error, 'Campaign Rations needs 4 Beast Meat.');
        const field = applyCookRecipe({ ryo: 999 }, cookRecipe('field-rations')!, NOW);
        assert.equal(field.ok, false);
        if (field.ok) return;
        assert.equal(field.error, 'Field Rations needs 1 Beast Meat.');
        // no message this endpoint can emit may leak a raw hunt-* id
        for (const message of [bare.error, field.error]) assert.doesNotMatch(message, /hunt-/);
        assert.equal(cookMaterialName('hunt-unknown'), 'hunt-unknown', 'an unmapped id falls back to itself, never undefined');
        assert.equal(cookMaterialChoiceName(cookRecipe('campaign-rations')!), 'Beast Meat');
    });
});

// 2026-10 item-use pass: the Feast is sold as a full restore, but its 9,999 flats
// stopped one point short of the 10,000 resource pools.
describe('_cafeteria - the Feast restores every bar to full', () => {
    it('fills drained 10,000-point pools exactly', () => {
        const meal = cafeteriaMeal('feast')!;
        const result = applyCafeteriaMeal({ ryo: 100, hp: 0, maxHp: 10_000, chakra: 0, maxChakra: 10_000, stamina: 0, maxStamina: 10_000 }, meal);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.character.hp, 10_000);
        assert.equal(result.character.chakra, 10_000);
        assert.equal(result.character.stamina, 10_000);
        assert.equal(result.character.ryo, 0);
    });
});