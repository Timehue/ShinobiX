import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';

/*
 * Always-on equipment boundary (enforceEquipmentOwnership): even with
 * with STRICT_RAW_SAVE_LEDGER disabled, an equipped id must already exist in
 * the stored backpack/equipment; incoming inventory is not an ownership proof.
 * Slots and duplicate placements are structurally validated as well.
 * Also pins the weaponElements server-ledger rule (attunements cannot be
 * client-forged).
 */

const wrap = (character: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...extra, character });

function withoutStrictLedger<T>(run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    process.env.STRICT_RAW_SAVE_LEDGER = '0';
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

/*
 * The `relic` slot (added 2026-08-16) holds story keepsakes and trinkets. It
 * exists so they stop competing with the Aura Sphere for `aura` — the sphere's
 * power is its accumulated progression, so equipping any keepsake used to
 * silently drop it. EQUIPMENT_SLOTS in [name].ts is an allowlist: a slot missing
 * from it is stripped from equipment on EVERY save write, so this pins the
 * server half of the wiring (the client half is the EquipmentSlot union).
 */
describe('the relic slot survives a save write', () => {
    it('keeps a relic equipped alongside the Aura Sphere', () => {
        const stored = baseChar({ inventory: ['aura-sphere', 'event-kesa-storm-seal'] });
        const out = sanitize(baseChar({
            inventory: ['aura-sphere', 'event-kesa-storm-seal'],
            equipment: { aura: 'aura-sphere', relic: 'event-kesa-storm-seal' },
        }), stored);
        assert.deepEqual(out.equipment, { aura: 'aura-sphere', relic: 'event-kesa-storm-seal' },
            'the relic slot must not be stripped, and must not evict the sphere');
    });

    it('rejects a relic-slot item forced into the aura slot', () => {
        const stored = baseChar({ inventory: ['event-kesa-storm-seal'] });
        const out = sanitize(baseChar({
            inventory: ['event-kesa-storm-seal'],
            equipment: { aura: 'event-kesa-storm-seal' },
        }), stored);
        assert.deepEqual(out.equipment, {}, 'slotAcceptsItemKind must reject a relic in the aura slot');
    });

    /*
     * The aura slot belongs to the Aura Sphere alone — it is the one
     * forever-improving keystone and its perks key off being equipped. This guard
     * is deliberately NOT grandfathered, so a save still holding one of the seven
     * keepsakes that used to live here (before the relic slot existed) has it
     * unequipped on the next write and the slot self-heals. The item is only
     * unequipped, never destroyed — it stays in the backpack.
     */
    it('keeps the aura slot exclusive to the Aura Sphere', () => {
        const stored = baseChar({ inventory: ['aura-sphere'] });
        const out = sanitize(baseChar({
            inventory: ['aura-sphere'],
            equipment: { aura: 'aura-sphere' },
        }), stored);
        assert.deepEqual(out.equipment, { aura: 'aura-sphere' }, 'the sphere itself is always welcome');
    });

    it('evicts a legacy keepsake squatting in the aura slot, even if grandfathered', () => {
        // The stored save has it equipped there — normally the grandfather clause
        // would preserve that. Aura exclusivity deliberately outranks it.
        const stored = baseChar({
            inventory: ['chakra-ring'],
            equipment: { aura: 'chakra-ring' },
        });
        const out = sanitize(baseChar({
            inventory: ['chakra-ring'],
            equipment: { aura: 'chakra-ring' },
        }), stored);
        assert.deepEqual(out.equipment, {}, 'the aura squatter is unequipped so the sphere can go back in');
        assert.deepEqual(out.inventory, ['chakra-ring'], 'and the item itself is NOT destroyed');
    });
});

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

    it('rejects a receiptless buy → equip landing in one POST', () => {
        const stored = baseChar();
        const out = sanitize(baseChar({
            inventory: ['rustfang-kunai', 'shinobi-vest'],
            equipment: { body: 'shinobi-vest' },
        }), stored);
        assert.deepEqual(out.inventory, ['rustfang-kunai']);
        assert.deepEqual(out.equipment, {});
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

describe('equipment ownership boundary (flag absent)', () => {
    it('still rejects a receiptless incoming buy-to-equip', () => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        delete process.env.STRICT_RAW_SAVE_LEDGER;
        try {
            const stored = baseChar();
            const out = sanitizeCharacterSave(wrap(baseChar({
                inventory: ['rustfang-kunai', 'shinobi-vest'],
                equipment: { body: 'shinobi-vest' },
            })), wrap(stored)).character as Record<string, unknown>;
            assert.deepEqual(out.inventory, ['rustfang-kunai']);
            assert.deepEqual(out.equipment, {});
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });
});
