import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOK_MATERIAL_IDS, COOK_RECIPES, cookMaterialChoiceName, cookMaterialName, cookRationsCapLine, cookRecipeGate, cookRecipeLine, countOwnedItem, DAILY_RATION_COOK_CAP, hasAnyCookMaterial, rationsCookedToday } from './cafeteria';

const NOW = Date.UTC(2026, 7, 22, 12);
const TODAY = '2026-08-22';
const field = COOK_RECIPES.find((r) => r.id === 'field-rations')!;
const campaign = COOK_RECIPES.find((r) => r.id === 'campaign-rations')!;

test('shared recipes use meat for field and campaign rations', () => {
    assert.deepEqual(field, { id: 'field-rations', name: 'Field Rations', ryo: 30, materials: ['hunt-beast-meat'], materialCount: 1, rations: 5, herbs: 1, fuel: 1 });
    assert.deepEqual(campaign, { id: 'campaign-rations', name: 'Campaign Rations', ryo: 80, materials: ['hunt-beast-meat'], materialCount: 4, rations: 20, herbs: 2, fuel: 2 });
    assert.equal(DAILY_RATION_COOK_CAP, 40);
});

test('countOwnedItem sums loose inventory slots and itemStacks', () => {
    assert.equal(countOwnedItem({ inventory: ['hunt-beast-meat', 'x', 'hunt-beast-meat'], itemStacks: [{ itemId: 'hunt-beast-meat', count: 3 }] }, 'hunt-beast-meat'), 5);
    assert.equal(countOwnedItem({}, 'hunt-beast-meat'), 0);
});

test('rationsCookedToday reads the UTC-day counter and resets on a new day', () => {
    assert.equal(rationsCookedToday({ rationsCookedDate: TODAY, rationsCookedToday: 25 }, NOW), 25);
    assert.equal(rationsCookedToday({ rationsCookedDate: '2026-08-21', rationsCookedToday: 25 }, NOW), 0);
    assert.equal(rationsCookedToday({}, NOW), 0);
    assert.equal(cookRationsCapLine({ rationsCookedDate: TODAY, rationsCookedToday: 25 }, NOW), 'Cooked today: 25/40 rations.');
});

test('cookRecipeGate: cap → ryo → material, in the server order', () => {
    const base = { ryo: 1_000, itemStacks: [{ itemId: 'gather-field-herb', count: 2 }, { itemId: 'hunt-beast-meat', count: 4 }, { itemId: 'hunt-ash-scale', count: 2 }, { itemId: 'gather-heartwood-bark', count: 2 }] };
    assert.deepEqual(cookRecipeGate(base, field, NOW), { ok: true, material: 'hunt-beast-meat' });
    assert.deepEqual(cookRecipeGate(base, campaign, NOW), { ok: true, material: 'hunt-beast-meat' });
    assert.deepEqual(cookRecipeGate({ ...base, rationsCookedDate: TODAY, rationsCookedToday: 36 }, field, NOW), { ok: false, reason: 'Daily limit: 36/40 rations cooked today' });
    // 36 + 5 > 40 but a stale date does not count
    assert.equal(cookRecipeGate({ ...base, rationsCookedDate: '2026-08-21', rationsCookedToday: 36 }, field, NOW).ok, true);
    assert.deepEqual(cookRecipeGate({ ...base, ryo: 29 }, field, NOW), { ok: false, reason: 'Not enough ryo (30 needed)' });
    assert.deepEqual(cookRecipeGate({ ryo: 100 }, campaign, NOW), { ok: false, reason: 'Needs 4 Beast Meat' });
    assert.deepEqual(cookRecipeGate({ ryo: 100 }, field, NOW), { ok: false, reason: 'Needs 1 Beast Meat' });
    assert.deepEqual(cookRecipeGate({ ...base, itemStacks: base.itemStacks.filter(stack => stack.itemId !== 'gather-heartwood-bark') }, campaign, NOW), { ok: false, reason: 'Needs 2 Heartwood Bark for cooking fuel (have 0)' });
});

test('cook materials are named, never raw ids', () => {
    assert.deepEqual(COOK_MATERIAL_IDS, ['gather-river-fish', 'gather-field-herb', 'gather-heartwood-bark', 'gather-river-fish-fine',
        'gather-river-fish-superior', 'gather-river-fish-pristine', 'hunt-beast-meat']);
    assert.equal(cookMaterialChoiceName(campaign), 'Beast Meat');
    assert.equal(cookMaterialChoiceName(field), 'Beast Meat');
    // an id the map has not heard of falls back to itself rather than "undefined"
    assert.equal(cookMaterialName('hunt-unknown'), 'hunt-unknown');
    for (const id of COOK_MATERIAL_IDS) assert.doesNotMatch(cookMaterialName(id), /^hunt-/, id);
});

test('cookRecipeLine reads as voice and takes every number from the recipe', () => {
    assert.equal(cookRecipeLine(field), '1 Beast Meat, 1 Field Herb, 1 Heartwood Bark for fuel and 30 ryo — five days of field rations.');
    assert.equal(cookRecipeLine(campaign), '4 Beast Meat, 2 Field Herbs, 2 Heartwood Bark for fuel and 80 ryo — twenty days of siege rations.');
    // an unlisted yield still renders, as a numeral rather than a blank
    assert.equal(
        cookRecipeLine({ ...field, ryo: 45, rations: 7 }),
        '1 Beast Meat, 1 Field Herb, 1 Heartwood Bark for fuel and 45 ryo — 7 days of field rations.',
    );
});

test('hasAnyCookMaterial decides whether the kitchen owes an empty state', () => {
    assert.equal(hasAnyCookMaterial({}), false);
    assert.equal(hasAnyCookMaterial({ inventory: ['ration-pack', 'item-smoke-bomb'] }), false, 'ration packs are the OUTPUT, not an input');
    assert.equal(hasAnyCookMaterial({ inventory: ['hunt-beast-meat'] }), true);
    assert.equal(hasAnyCookMaterial({ itemStacks: [{ itemId: 'hunt-ash-scale', count: 1 }] }), false, 'scales are not food');
    assert.equal(hasAnyCookMaterial({ itemStacks: [{ itemId: 'hunt-ash-scale', count: 0 }] }), false, 'an empty stack is not a material');
});

test('the Noodle Den screen has an empty state, a toast, and no "?" in a confirmation', async () => {
    const { readFileSync } = await import('node:fs');
    const screen = readFileSync(new URL('../screens/Cafeteria.tsx', import.meta.url), 'utf8');
    assert.match(screen, /title="Noodle Den"/);
    assert.match(screen, /The Noodle Den is too busy right now\./);
    // 1a: the dead-button case gets copy that says where the inputs come from.
    assert.match(screen, /Bring back fish from water nodes or spoils from hunting to cook ration packs/);
    assert.match(screen, /hasSpoils \?/);
    // Fish cooking remains available; hunting recipes still honor Village Stores.
    assert.match(screen, /capabilityAdmissionAllowed\(useCapabilityViewAvailability\("villageWar"\)\)/);
    assert.match(screen, /<section className="summary-box cafe-kitchen">/);
    assert.match(screen, /recipe\.id\.startsWith\('fish-rations-'\) \|\| \(storesOpen && !kitchenClosed\)/);
    // and the server-only stores kill switch (a bare 'Not found.') becomes one
    // in-section notice rather than a modal per press
    assert.match(screen, /if \(\/not found\/i\.test\(res\.error \?\? ""\)\) \{ setKitchenClosed\(true\); return; \}/);
    // 1c: the refusal appears once, below the button — not as a title attribute.
    assert.doesNotMatch(screen, /title=\{gate\.ok \? undefined : gate\.reason\}/);
    assert.equal(screen.match(/gate\.reason/g)?.length, 2, 'once in the handler, once in the hint under the button');
    // 1d/1e
    assert.match(screen, /\{cookRationsCapLine\(character\)\} Resets at midnight UTC\./);
    assert.doesNotMatch(screen, /\.\.\./, 'use … rather than three dots');
    // C3/C5: routine success is a toast, and never renders "?"
    assert.match(screen, /gameToast\(\s*`Cooked \$\{cooked\} rations/);
    assert.doesNotMatch(screen, /\?\/\?/);
    assert.doesNotMatch(screen, /\?\? "\?"/);
});
