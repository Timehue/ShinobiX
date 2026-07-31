import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';

/*
 * Always-on equipment boundary (enforceEquipmentOwnership): even with
 * STRICT_RAW_SAVE_LEDGER off (the production default today), an equipped id
 * must exist somewhere the player can hold it — the stored backpack/equipment
 * or the incoming backpack — and slots/dupes are structurally validated.
 * Also pins the weaponElements server-ledger rule (attunements cannot be
 * client-forged).
 */

const wrap = (character: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...extra, character });

function withoutStrictLedger<T>(run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    delete process.env.STRICT_RAW_SAVE_LEDGER;
    try {
        return run();
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
}

const baseChar = (over: Record<string, unknown> = {}) => ({
    name: 'Holder', level: 20,
    inventory: ['rustfang-kunai'],
    itemStacks: [],
    equipment: {},
    ...over,
});

const sanitize = (incoming: Record<string, unknown>, existing: Record<string, unknown>) =>
    withoutStrictLedger(() => sanitizeCharacterSave(wrap(incoming), wrap(existing)).character as Record<string, unknown>);

describe('equipment ownership boundary (non-strict mode)', () => {
    it('strips an equipped built-in id the player owns nowhere', () => {
        const stored = baseChar();
        const forged = baseChar({ equipment: { body: 'mythic-battle-plate', hand: 'worldsplitter-katana' } });
        const out = sanitize(forged, stored);
        assert.deepEqual(out.equipment, {}, 'unowned gear must not survive the save write');
    });

    it('keeps gear that is already equipped on the stored save (grandfathered)', () => {
        const stored = baseChar({ equipment: { hand: 'worldsplitter-katana' } });
        const out = sanitize(baseChar({ equipment: { hand: 'worldsplitter-katana' } }), stored);
        assert.equal((out.equipment as Record<string, unknown>).hand, 'worldsplitter-katana');
    });

    it('keeps gear backed by the stored backpack', () => {
        const stored = baseChar({ inventory: ['rustfang-kunai', 'shinobi-vest'] });
        const out = sanitize(baseChar({ equipment: { body: 'shinobi-vest' } }), stored);
        assert.equal((out.equipment as Record<string, unknown>).body, 'shinobi-vest');
    });

    it('accepts a buy → equip landing in one POST (incoming backpack counts)', () => {
        const stored = baseChar();
        const out = sanitize(baseChar({
            inventory: ['rustfang-kunai', 'shinobi-vest'],
            equipment: { body: 'shinobi-vest' },
        }), stored);
        assert.equal((out.equipment as Record<string, unknown>).body, 'shinobi-vest');
    });

    it('collapses duplicate ids and canonical-slot aliases', () => {
        const stored = baseChar({ inventory: ['shinobi-vest', 'rustfang-kunai'] });
        const out = sanitize(baseChar({
            inventory: ['shinobi-vest', 'rustfang-kunai'],
            equipment: {
                body: 'shinobi-vest',
                armor: 'shinobi-vest',        // same id again + alias slot of body
                hand: 'rustfang-kunai',
                weapon: 'rustfang-kunai',     // alias slot of hand
                bogusSlot: 'shinobi-vest',    // unknown slot name
            },
        }), stored);
        const equipment = out.equipment as Record<string, unknown>;
        assert.deepEqual(equipment, { body: 'shinobi-vest', hand: 'rustfang-kunai' });
    });

    it('rejects a built-in item equipped into a slot its definition does not fit', () => {
        // shinobi-vest is slot "body"; parked in "head" it would stack armor DR
        // the item never earned (DR is summed per SLOT KEY in _multipliers.ts).
        const stored = baseChar({ inventory: ['shinobi-vest', 'rustfang-kunai'] });
        const out = sanitize(baseChar({
            inventory: ['shinobi-vest', 'rustfang-kunai'],
            equipment: { head: 'shinobi-vest', thrown: 'rustfang-kunai' },
        }), stored);
        assert.deepEqual(out.equipment, {}, 'a body plate in head and a hand weapon in thrown are both rejected');
    });

    it('grandfathers a misplacement already present on the stored save', () => {
        const stored = baseChar({ equipment: { head: 'shinobi-vest' } });
        const out = sanitize(baseChar({ equipment: { head: 'shinobi-vest' } }), stored);
        assert.equal((out.equipment as Record<string, unknown>).head, 'shinobi-vest', 'existing loadouts never change out from under a player');
    });

    it('slot aliases satisfy the kind check (weapon→hand, armor→body)', () => {
        const stored = baseChar({ inventory: ['shinobi-vest', 'rustfang-kunai'] });
        const out = sanitize(baseChar({
            inventory: ['shinobi-vest', 'rustfang-kunai'],
            equipment: { weapon: 'rustfang-kunai', armor: 'shinobi-vest' },
        }), stored);
        const equipment = out.equipment as Record<string, unknown>;
        assert.equal(equipment.weapon, 'rustfang-kunai');
        assert.equal(equipment.armor, 'shinobi-vest');
    });

    it('itemStacks count as ownership for reference slots', () => {
        const stored = baseChar({ itemStacks: [{ itemId: 'shuriken', count: 5 }] });
        const out = sanitize(baseChar({
            itemStacks: [{ itemId: 'shuriken', count: 5 }],
            equipment: { thrown: 'shuriken' },
        }), stored);
        assert.equal((out.equipment as Record<string, unknown>).thrown, 'shuriken');
    });
});

describe('weaponElements is server-owned', () => {
    it('a client-forged attunement map is replaced by the stored copy', () => {
        const stored = baseChar({ weaponElements: { 'worldsplitter-katana': 'Fire' } });
        const out = sanitize(baseChar({ weaponElements: { 'worldsplitter-katana': 'Lightning', 'other-blade': 'Water' } }), stored);
        assert.deepEqual(out.weaponElements, { 'worldsplitter-katana': 'Fire' }, 'only the Core-endpoint-written map persists');
    });

    it('a client cannot introduce weaponElements from nothing', () => {
        const stored = baseChar();
        const out = sanitize(baseChar({ weaponElements: { 'worldsplitter-katana': 'Fire' } }), stored);
        assert.equal(out.weaponElements, undefined, 'no stored attunement → the field is deleted');
    });
});
