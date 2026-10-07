import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';
import { stepItemId } from '../../shared/gear-steps.js';

type Character = Record<string, unknown>;
const weapon = 'named-weapon-123456781234123412341234567890ab';
const armor = 'named-armor-223456781234123412341234567890ab';
const kunai = 'rustfang-kunai';
const step = stepItemId('rustfang-kunai', 2);

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

for (const flag of [undefined, '0', '1']) describe(`worn named gear is remembered, strict ledger ${flag ?? 'unset'}`, () => {
    it('equipping a named weapon records it, and unequipping keeps the record', () => withLedger(flag, () => {
        const stored = character({ inventory: [weapon] });
        const worn = save({ ...stored, inventory: [], equipment: { hand: weapon } }, stored);
        assert.deepEqual(worn.equippedNamedGear, [weapon]);
        const bagged = save({ ...worn, inventory: [weapon], equipment: {} }, worn);
        assert.deepEqual(bagged.equippedNamedGear, [weapon], 'taking it off does not undo the record');
        assert.deepEqual(bagged.inventory, [weapon]);
    }));

    it('a named piece that was never worn is not recorded', () => withLedger(flag, () => {
        const stored = character({ inventory: [weapon, armor] });
        const next = save({ ...stored }, stored);
        assert.equal(next.equippedNamedGear, undefined);
    }));

    it('built in weapons, armor and the upgrade pieces are never recorded', () => withLedger(flag, () => {
        const stored = character({ inventory: [kunai, step, 'reinforced-vest'] });
        const worn = save({ ...stored, inventory: [], equipment: { hand: step, body: 'reinforced-vest' } }, stored);
        assert.equal(worn.equippedNamedGear, undefined);
    }));

    it('a client cannot clear the record or edit it', () => withLedger(flag, () => {
        const stored = character({ inventory: [weapon], equippedNamedGear: [weapon] });
        const cleared = save({ ...stored, equippedNamedGear: [] }, stored);
        assert.deepEqual(cleared.equippedNamedGear, [weapon]);
        const removedField = save({ name: 'holder', level: 100, ryo: 0, inventory: [weapon], itemStacks: [], equipment: {}, stats: {} }, stored);
        assert.deepEqual(removedField.equippedNamedGear, [weapon]);
    }));

    it('a client cannot add a piece that is not worn or not owned', () => withLedger(flag, () => {
        const stored = character({ inventory: [weapon] });
        const next = save({ ...stored, equippedNamedGear: [weapon, armor, 'rustfang-kunai'] }, stored);
        assert.equal(next.equippedNamedGear, undefined, 'claiming a record does not create one');
    }));

    it('a piece that left the player is dropped from the record, so it cannot grow forever', () => withLedger(flag, () => {
        const stored = character({ inventory: [armor], equippedNamedGear: [weapon, armor] });
        const next = save({ ...stored }, stored);
        assert.deepEqual(next.equippedNamedGear, [armor]);
    }));

    it('a second piece equipped on a later save is added to the existing record', () => withLedger(flag, () => {
        const stored = character({ inventory: [armor], equipment: { hand: weapon }, equippedNamedGear: [weapon] });
        const next = save({ ...stored, inventory: [], equipment: { hand: weapon, body: armor } }, stored);
        assert.deepEqual([...(next.equippedNamedGear as string[])].sort(), [weapon, armor].sort());
    }));

    it('when the last recorded piece leaves, an empty list is written so the save merge cannot bring the old one back', () => withLedger(flag, () => {
        const stored = character({ inventory: [], equippedNamedGear: [weapon] });
        const next = save({ ...stored }, stored);
        assert.deepEqual(next.equippedNamedGear, []);
    }));

    it('ids are stored lower case and a mixed case id is the same piece', () => withLedger(flag, () => {
        const mixed = 'named-weapon-123456781234123412341234567890AB';
        const stored = character({ inventory: [mixed] });
        const worn = save({ ...stored, inventory: [], equipment: { hand: mixed } }, stored);
        assert.deepEqual(worn.equippedNamedGear, [mixed.toLowerCase()]);
    }));

    it('both a worn weapon and a worn armor piece are recorded together', () => withLedger(flag, () => {
        const stored = character({ inventory: [weapon, armor] });
        const worn = save({ ...stored, inventory: [], equipment: { hand: weapon, body: armor } }, stored);
        assert.deepEqual([...(worn.equippedNamedGear as string[])].sort(), [weapon, armor].sort());
    }));

    it('a first save records nothing', () => withLedger(flag, () => {
        const first = sanitizeCharacterSave({ character: character({ inventory: [weapon], equipment: { hand: weapon } }) }, null).character as Character;
        assert.equal(first.equippedNamedGear, undefined);
    }));
});
