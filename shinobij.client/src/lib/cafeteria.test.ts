import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOK_MATERIAL_IDS, COOK_RECIPES, cookMaterialChoiceName, cookMaterialName, cookRationsCapLine, cookRecipeGate, cookRecipeLine, countOwnedItem, DAILY_RATION_COOK_CAP, hasAnyCookMaterial, rationsCookedToday } from './cafeteria';

const NOW = Date.UTC(2026, 7, 22, 12);
const TODAY = '2026-08-22';
const field = COOK_RECIPES.find((r) => r.id === 'field-rations')!;
const campaign = COOK_RECIPES.find((r) => r.id === 'campaign-rations')!;

test('recipes mirror the server: field 1 beast meat + 30 ryo → 5; campaign pelt-or-scale + 80 ryo → 20', () => {
    assert.deepEqual(field, { id: 'field-rations', name: 'Field Rations', ryo: 30, materials: ['hunt-beast-meat'], rations: 5 });
    assert.deepEqual(campaign, { id: 'campaign-rations', name: 'Campaign Rations', ryo: 80, materials: ['hunt-frost-pelt', 'hunt-ash-scale'], rations: 20 });
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
    const base = { ryo: 1_000, itemStacks: [{ itemId: 'hunt-beast-meat', count: 1 }, { itemId: 'hunt-ash-scale', count: 2 }] };
    assert.deepEqual(cookRecipeGate(base, field, NOW), { ok: true, material: 'hunt-beast-meat' });
    // campaign picks the first OWNED material (frost pelt absent → ash scale)
    assert.deepEqual(cookRecipeGate(base, campaign, NOW), { ok: true, material: 'hunt-ash-scale' });
    assert.deepEqual(cookRecipeGate({ ...base, rationsCookedDate: TODAY, rationsCookedToday: 36 }, field, NOW), { ok: false, reason: 'Daily limit: 36/40 rations cooked today' });
    // 36 + 5 > 40 but a stale date does not count
    assert.equal(cookRecipeGate({ ...base, rationsCookedDate: '2026-08-21', rationsCookedToday: 36 }, field, NOW).ok, true);
    assert.deepEqual(cookRecipeGate({ ...base, ryo: 29 }, field, NOW), { ok: false, reason: 'Not enough ryo (30 needed)' });
    assert.deepEqual(cookRecipeGate({ ryo: 100 }, campaign, NOW), { ok: false, reason: 'Needs 1 Frost Pelt or Ash Scale' });
    assert.deepEqual(cookRecipeGate({ ryo: 100 }, field, NOW), { ok: false, reason: 'Needs 1 Beast Meat' });
});

test('cook materials are named, never raw ids', () => {
    assert.deepEqual(COOK_MATERIAL_IDS, ['hunt-beast-meat', 'hunt-frost-pelt', 'hunt-ash-scale']);
    assert.equal(cookMaterialName('hunt-frost-pelt'), 'Frost Pelt');
    assert.equal(cookMaterialChoiceName(campaign), 'Frost Pelt or Ash Scale');
    assert.equal(cookMaterialChoiceName(field), 'Beast Meat');
    // an id the map has not heard of falls back to itself rather than "undefined"
    assert.equal(cookMaterialName('hunt-unknown'), 'hunt-unknown');
    for (const id of COOK_MATERIAL_IDS) assert.doesNotMatch(cookMaterialName(id), /^hunt-/, id);
});

test('cookRecipeLine reads as voice and takes every number from the recipe', () => {
    assert.equal(cookRecipeLine(field), 'Beast Meat and 30 ryo — five days of field rations.');
    assert.equal(cookRecipeLine(campaign), 'Frost Pelt or Ash Scale and 80 ryo — twenty days of siege rations.');
    // an unlisted yield still renders, as a numeral rather than a blank
    assert.equal(
        cookRecipeLine({ ...field, ryo: 45, rations: 7 }),
        'Beast Meat and 45 ryo — 7 days of field rations.',
    );
});

test('hasAnyCookMaterial decides whether the kitchen owes an empty state', () => {
    assert.equal(hasAnyCookMaterial({}), false);
    assert.equal(hasAnyCookMaterial({ inventory: ['ration-pack', 'item-smoke-bomb'] }), false, 'ration packs are the OUTPUT, not an input');
    assert.equal(hasAnyCookMaterial({ inventory: ['hunt-beast-meat'] }), true);
    assert.equal(hasAnyCookMaterial({ itemStacks: [{ itemId: 'hunt-ash-scale', count: 1 }] }), true);
    assert.equal(hasAnyCookMaterial({ itemStacks: [{ itemId: 'hunt-ash-scale', count: 0 }] }), false, 'an empty stack is not a material');
});

test('the Cafeteria screen has an empty state, a toast, and no "?" in a confirmation', async () => {
    const { readFileSync } = await import('node:fs');
    const screen = readFileSync(new URL('../screens/Cafeteria.tsx', import.meta.url), 'utf8');
    // 1a: the dead-button case gets copy that says where the inputs come from.
    assert.match(screen, /You’re carrying no hunt spoils\. Beast Meat and pelts drop from hunting beasts in the wilds/);
    assert.match(screen, /hasSpoils \?/);
    // 1b: the cook section is hidden unless the war/stores layer is available.
    assert.match(screen, /capabilityAdmissionAllowed\(useCapabilityViewAvailability\("villageWar"\)\)/);
    assert.match(screen, /\{storesOpen && <section className="summary-box cafe-kitchen">/);
    // and the server-only stores kill switch (a bare 'Not found.') becomes one
    // in-section notice rather than a modal per press
    assert.match(screen, /if \(\/not found\/i\.test\(res\.error \?\? ""\)\) \{ setKitchenClosed\(true\); return; \}/);
    assert.match(screen, /The kitchens are closed while the village stores are offline\./);
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
