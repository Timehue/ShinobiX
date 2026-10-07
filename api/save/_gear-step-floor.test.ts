import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { stepItemId } from '../../shared/gear-steps.js';

type Character = Record<string, unknown>;
const stepWeapon = stepItemId('rustfang-kunai', 1);
const otherStepWeapon = stepItemId('rustfang-kunai', 2);
const stepArmor = stepItemId('reinforced-vest', 1);
const kunai = 'rustfang-kunai';

const character = (overrides: Character = {}): Character => ({
    name: 'holder', level: 100, ryo: 0, inventory: [], itemStacks: [], equipment: {}, stats: {}, ...overrides,
});
const save = (incoming: Character, stored: Character, opts: Parameters<typeof sanitizeCharacterSave>[2] = {}) =>
    sanitizeCharacterSave({ character: incoming }, { character: stored }, opts).character as Character;

function withLedger<T>(flag: string | undefined, run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    if (flag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
    else process.env.STRICT_RAW_SAVE_LEDGER = flag;
    try { return run(); }
    finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
}

const count = (list: unknown, id: string) => (list as string[]).filter(value => value === id).length;

it('the step ids used by this suite exist in the server catalog', () => {
    for (const id of [stepWeapon, otherStepWeapon, stepArmor]) assert.ok(ITEM_CATALOG[id], id);
});

for (const flag of [undefined, '0', '1']) describe(`step gear floor, strict ledger ${flag ?? 'unset'}`, () => {
    it('a stale autosave that never saw the granted piece cannot erase it', () => withLedger(flag, () => {
        const stored = character({ inventory: [kunai, stepWeapon] });
        const stale = save({ ...stored, inventory: [kunai] }, stored);
        assert.equal(count(stale.inventory, stepWeapon), 1);
        assert.equal(count(stale.inventory, kunai), 1);
    }));

    it('an inventory wiped by a stale save keeps every stored step unit', () => withLedger(flag, () => {
        const stored = character({ inventory: [stepWeapon, stepWeapon, stepArmor, otherStepWeapon] });
        const stale = save({ ...stored, inventory: [] }, stored);
        assert.equal(count(stale.inventory, stepWeapon), 2);
        assert.equal(count(stale.inventory, stepArmor), 1);
        assert.equal(count(stale.inventory, otherStepWeapon), 1);
    }));

    it('an equipped piece that a stale save unequips and drops is returned to the backpack', () => withLedger(flag, () => {
        const stored = character({ equipment: { hand: stepWeapon } });
        const stale = save({ ...stored, inventory: [], equipment: {} }, stored);
        assert.equal(count(stale.inventory, stepWeapon), 1);
    }));

    it('a normal equip move is not duplicated and a normal unequip is not lost', () => withLedger(flag, () => {
        const stored = character({ inventory: [stepWeapon] });
        const equipped = save({ ...stored, inventory: [], equipment: { hand: stepWeapon } }, stored);
        assert.deepEqual(equipped.equipment, { hand: stepWeapon });
        assert.equal(count(equipped.inventory, stepWeapon), 0);
        const back = save({ ...equipped, inventory: [stepWeapon], equipment: {} }, equipped);
        assert.deepEqual(back.equipment, {});
        assert.equal(count(back.inventory, stepWeapon), 1);
    }));

    it('swapping between a base item and a step item keeps both', () => withLedger(flag, () => {
        const stored = character({ inventory: [stepWeapon], equipment: { hand: kunai } });
        const swapped = save({ ...stored, inventory: [kunai], equipment: { hand: stepWeapon } }, stored);
        assert.deepEqual(swapped.equipment, { hand: stepWeapon });
        assert.equal(count(swapped.inventory, kunai), 1);
        assert.equal(count(swapped.inventory, stepWeapon), 0);
    }));

    it('never mints a piece: a save claiming more than stored is still trimmed', () => withLedger(flag, () => {
        const stored = character({ inventory: [stepWeapon] });
        const forged = save({ ...stored, inventory: [stepWeapon, stepWeapon, stepWeapon] }, stored);
        assert.equal(count(forged.inventory, stepWeapon), 1);
        const fromNothing = save({ ...character(), inventory: [stepWeapon] }, character());
        assert.equal(count(fromNothing.inventory, stepWeapon), 0);
    }));

    it('a sale that already wrote the stored record is not undone', () => withLedger(flag, () => {
        const afterSale = character({ inventory: [kunai], ryo: 500 });
        const staleClient = save({ ...afterSale, inventory: [kunai, stepWeapon] }, afterSale);
        assert.equal(count(staleClient.inventory, stepWeapon), 0, 'the sold piece is not restored');
        assert.equal(staleClient.ryo, 500);
    }));

    it('leaves non step items alone, including ones that shrink', () => withLedger(flag, () => {
        const stored = character({ inventory: [kunai, kunai, stepWeapon] });
        const next = save({ ...stored, inventory: [kunai, stepWeapon] }, stored);
        assert.equal(count(next.inventory, kunai), 1);
        assert.equal(count(next.inventory, stepWeapon), 1);
    }));

    it('the admin writer may remove a step piece', () => withLedger(flag, () => {
        const stored = character({ inventory: [stepWeapon] });
        const admin = save({ ...stored, inventory: [] }, stored, { allowGearStepRemoval: true });
        assert.equal(count(admin.inventory, stepWeapon), 0);
    }));

    it('an id that only looks like a step piece, not in the catalog, is not protected', () => withLedger(flag, () => {
        const lookalike = 'custom-sword-s1';
        assert.equal(ITEM_CATALOG[lookalike], undefined);
        const stored = character({ inventory: [lookalike, kunai] });
        const next = save({ ...stored, inventory: [kunai] }, stored);
        assert.equal(count(next.inventory, lookalike), 0);
    }));

    it('a first save gets no floor', () => withLedger(flag, () => {
        const first = sanitizeCharacterSave({ character: character({ inventory: [stepWeapon] }) }, null).character as Character;
        assert.equal(count(first.inventory, stepWeapon), 0);
    }));
});
