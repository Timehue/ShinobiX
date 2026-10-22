/*
 * Hunt materials and the Weekly Boss Core became counted stacks (owner ruling
 * A12, 2026-10 rebalance). A live save still holds them as one inventory[]
 * entry per unit, so every save write folds those copies into itemStacks
 * (api/save/[name].ts -> foldStackedMaterialsOnSave). These tests drive the REAL
 * save sanitizer through repeated save / reload cycles and prove the fold:
 *   - conserves every unit of every id, exactly, in both ledger modes;
 *   - is idempotent (the second write changes nothing);
 *   - lets an old client that still sends inventory[] copies neither duplicate
 *     nor lose a unit against an already-folded stored save;
 *   - never clamps a unit away: a copy that cannot fit a full stack stays put.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';
import { ITEM_STACK_MAX, STACKED_MATERIAL_IDS, heldUnits, isStackedMaterialId } from '../../shared/stacked-materials.js';

type Char = Record<string, unknown> & { inventory: string[]; itemStacks: Array<{ itemId: string; count: number }> };

const copies = (id: string, n: number) => Array.from({ length: n }, () => id);

function legacyCharacter(): Char {
    return {
        name: 'stackfold', level: 70, village: 'Mist',
        hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
        stats: {}, equipment: {},
        inventory: [
            'rustfang-kunai',
            ...copies('hunt-legendary-material', 7),
            ...copies('hunt-ancient-beast-core', 2),
            'weekly-boss-core',
            ...copies('hunt-torn-hide', 30),
            'shinobi-vest',
            ...copies('hunt-titan-bone', 3),
        ],
        itemStacks: [
            { itemId: 'hunt-legendary-material', count: 5 },
            { itemId: 'gather-iron-sand', count: 4 },
        ],
    };
}

const save = (character: Record<string, unknown>) => ({ character: structuredClone(character) });
const charOf = (out: Record<string, unknown>) => out.character as Char;
const TRACKED = [...STACKED_MATERIAL_IDS, 'rustfang-kunai', 'shinobi-vest', 'gather-iron-sand'];
const census = (c: Record<string, unknown>) => Object.fromEntries(TRACKED.map((id) => [id, heldUnits(c, id)]));

for (const mode of ['0', '1'] as const) {
    describe(`hunt-material stack fold on save (STRICT_RAW_SAVE_LEDGER=${mode})`, () => {
        let previous: string | undefined;
        beforeEach(() => { previous = process.env.STRICT_RAW_SAVE_LEDGER; process.env.STRICT_RAW_SAVE_LEDGER = mode; });
        afterEach(() => { if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER; else process.env.STRICT_RAW_SAVE_LEDGER = previous; });

        it('folds a legacy save into stacks with exact counts, and repeated writes change nothing', () => {
            const stored = legacyCharacter();
            const before = census(stored);
            const first = charOf(sanitizeCharacterSave(save(stored), save(stored)));
            assert.deepEqual(census(first), before, 'every unit of every id survives the first write');
            assert.equal(first.inventory.filter(isStackedMaterialId).length, 0, 'no hunt material is left as an inventory[] entry');
            assert.deepEqual(first.inventory, ['rustfang-kunai', 'shinobi-vest'], 'unique gear stays in inventory[], in order');
            const stack = (c: Char, id: string) => c.itemStacks.find((s) => s.itemId === id)?.count;
            assert.equal(stack(first, 'hunt-legendary-material'), 12, '5 stacked + 7 loose');
            assert.equal(stack(first, 'hunt-torn-hide'), 30);
            assert.equal(stack(first, 'weekly-boss-core'), 1);
            assert.equal(stack(first, 'gather-iron-sand'), 4, 'an unrelated stack is untouched');

            // Reload and save again, ten times over: the stored save is the fold.
            let current = first;
            for (let i = 0; i < 10; i++) {
                const next = charOf(sanitizeCharacterSave(save(current), save(current)));
                assert.deepEqual(next.inventory, first.inventory, `write ${i + 2} keeps inventory[] identical`);
                assert.deepEqual(next.itemStacks, first.itemStacks, `write ${i + 2} keeps itemStacks identical`);
                current = next;
            }
            assert.deepEqual(census(current), before);
        });

        it('an old client still sending inventory[] copies against a folded save neither duplicates nor loses a unit', () => {
            const legacy = legacyCharacter();
            const folded = charOf(sanitizeCharacterSave(save(legacy), save(legacy)));
            // The stale tab re-sends the pre-fold shape on top of the folded stored save.
            const out = charOf(sanitizeCharacterSave(save(legacy), save(folded)));
            assert.deepEqual(census(out), census(legacy));
            assert.equal(out.inventory.filter(isStackedMaterialId).length, 0);
            // And a stale tab that also invents extra copies gains nothing.
            const forged = { ...legacy, inventory: [...legacy.inventory, ...copies('hunt-legendary-material', 50)] };
            assert.deepEqual(census(charOf(sanitizeCharacterSave(save(forged), save(folded)))), census(legacy));
        });

        it('a spent unit stays spent: the fold never refills a stack the client drew down', () => {
            const legacy = legacyCharacter();
            const folded = charOf(sanitizeCharacterSave(save(legacy), save(legacy)));
            const spent = { ...folded, itemStacks: folded.itemStacks.map((s) => s.itemId === 'hunt-torn-hide' ? { ...s, count: 18 } : s) };
            const out = charOf(sanitizeCharacterSave(save(spent), save(folded)));
            assert.equal(heldUnits(out, 'hunt-torn-hide'), 18);
            assert.equal(heldUnits(out, 'hunt-legendary-material'), 12);
        });

        it('a copy that does not fit a full stack stays in inventory[] instead of being clamped away', () => {
            const stored = {
                ...legacyCharacter(),
                inventory: ['rustfang-kunai', ...copies('hunt-wild-feather', 3)],
                itemStacks: [{ itemId: 'hunt-wild-feather', count: ITEM_STACK_MAX }],
            };
            const out = charOf(sanitizeCharacterSave(save(stored), save(stored)));
            assert.equal(heldUnits(out, 'hunt-wild-feather'), ITEM_STACK_MAX + 3);
            assert.equal(out.itemStacks.find((s) => s.itemId === 'hunt-wild-feather')?.count, ITEM_STACK_MAX);
            const again = charOf(sanitizeCharacterSave(save(out), save(out)));
            assert.deepEqual(again.inventory, out.inventory);
            assert.deepEqual(again.itemStacks, out.itemStacks);
        });
    });
}
