import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namedForgeIngredients, namedForgeShortfall, planNamedForgeMaterials } from './named-forge-materials.js';
import { craftMaterialName } from './crafting-recipes.js';

test('every named roll ingredient has a player-facing name, never a raw id', () => {
    for (const kind of ['weapon', 'armor'] as const) {
        for (const ingredient of namedForgeIngredients(kind)) {
            assert.doesNotMatch(ingredient.label, /^(hunt-|gather-|dungeon-)/, `${kind}: ${ingredient.label}`);
            for (const id of ingredient.ids) assert.doesNotMatch(craftMaterialName(id), /^(hunt-|gather-|dungeon-)/, id);
        }
    }
});

test('a roll plans every row or nothing, and names the first short row', () => {
    for (const kind of ['weapon', 'armor'] as const) {
        const full = new Map(namedForgeIngredients(kind).map((ingredient) => [ingredient.ids[0], ingredient.count]));
        const owned = (id: string) => full.get(id) ?? 0;
        assert.ok(planNamedForgeMaterials(kind, owned), kind);
        assert.equal(namedForgeShortfall(kind, owned), null);
        const last = namedForgeIngredients(kind).at(-1)!;
        const short = (id: string) => (id === last.ids[0] ? last.count - 1 : owned(id));
        assert.equal(planNamedForgeMaterials(kind, short), null, `${kind} must not plan a partial roll`);
        assert.equal(namedForgeShortfall(kind, short)?.label, last.label);
    }
});
