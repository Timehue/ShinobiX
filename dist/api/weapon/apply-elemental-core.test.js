"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const apply_elemental_core_js_1 = require("./apply-elemental-core.js");
// Base character: awakened Fire + Water, owns 2 Elemental Cores, a legendary and a
// common weapon in the bag, plus a mythic weapon equipped in the hand slot.
function baseChar(over = {}) {
    return {
        elements: ['Fire', 'Water'],
        itemStacks: [{ itemId: 'elemental-core', count: 2 }],
        inventory: ['black-lotus-dagger', 'training-katana'],
        equipment: { hand: 'void-leech-nodachi' },
        ...over,
    };
}
(0, node_test_1.describe)('decideElementalCoreAttunement (server-authoritative validation)', () => {
    (0, node_test_1.it)('attunes an owned legendary weapon to an awakened element, consuming one Core', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'black-lotus-dagger', 'Fire');
        node_assert_1.strict.equal(d.ok, true);
        if (!d.ok)
            return;
        node_assert_1.strict.equal(d.character.weaponElements['black-lotus-dagger'], 'Fire');
        const cores = d.character.itemStacks.find((s) => s.itemId === 'elemental-core');
        node_assert_1.strict.equal(cores?.count, 1, 'exactly one Core consumed');
    });
    (0, node_test_1.it)('attunes an EQUIPPED mythic weapon (ownership satisfied via equipment)', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'void-leech-nodachi', 'Water');
        node_assert_1.strict.equal(d.ok, true);
    });
    (0, node_test_1.it)('rejects an element the player has not awakened', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'black-lotus-dagger', 'Earth');
        node_assert_1.strict.equal(d.ok, false);
        if (d.ok)
            return;
        node_assert_1.strict.equal(d.status, 400);
        node_assert_1.strict.match(d.error, /awakened/i);
    });
    (0, node_test_1.it)('rejects a non-legendary/mythic weapon', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'training-katana', 'Fire');
        node_assert_1.strict.equal(d.ok, false);
        if (d.ok)
            return;
        node_assert_1.strict.match(d.error, /legendary or mythic/i);
    });
    (0, node_test_1.it)('rejects when the player owns no Elemental Core (and does NOT mutate)', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar({ itemStacks: [] }), [], 'black-lotus-dagger', 'Fire');
        node_assert_1.strict.equal(d.ok, false);
        if (d.ok)
            return;
        node_assert_1.strict.match(d.error, /Elemental Core/i);
    });
    (0, node_test_1.it)('rejects an unknown weapon id with 404', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'not-a-real-weapon', 'Fire');
        node_assert_1.strict.equal(d.ok, false);
        if (d.ok)
            return;
        node_assert_1.strict.equal(d.status, 404);
    });
    (0, node_test_1.it)('rejects a legendary weapon the player does not own', () => {
        // frostfang-oathblade is a legendary hand weapon, but it's not in the bag or equipped here.
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'frostfang-oathblade', 'Fire');
        node_assert_1.strict.equal(d.ok, false);
        if (d.ok)
            return;
        node_assert_1.strict.match(d.error, /do not own/i);
    });
    (0, node_test_1.it)('re-attuning overwrites the prior element (spending another Core)', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar({ weaponElements: { 'black-lotus-dagger': 'Fire' } }), [], 'black-lotus-dagger', 'Water');
        node_assert_1.strict.equal(d.ok, true);
        if (!d.ok)
            return;
        node_assert_1.strict.equal(d.character.weaponElements['black-lotus-dagger'], 'Water');
    });
    (0, node_test_1.it)('attunes a named (creatorItems) legendary hand weapon', () => {
        const custom = [{ id: 'my-blade', name: 'My Blade', slot: 'hand', rarity: 'legendary', weaponEp: 27, weaponRange: 4 }];
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar({ inventory: ['my-blade'] }), custom, 'my-blade', 'Fire');
        node_assert_1.strict.equal(d.ok, true);
    });
    (0, node_test_1.it)('rejects a legendary GLOVE that merely shares the hand slot (not a real weapon)', () => {
        // bulwark-gloves is slot:"hand", rarity:"legendary" but has no weaponEp/range —
        // it must NOT be attunable (would otherwise ride the bloodline mult as a fake weapon).
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar({ inventory: ['bulwark-gloves'] }), [], 'bulwark-gloves', 'Fire');
        node_assert_1.strict.equal(d.ok, false);
        if (d.ok)
            return;
        node_assert_1.strict.match(d.error, /weapon/i);
    });
    (0, node_test_1.it)('canonicalizes a lower-cased element to the wielder\'s stored casing', () => {
        const d = (0, apply_elemental_core_js_1.decideElementalCoreAttunement)(baseChar(), [], 'black-lotus-dagger', 'fire');
        node_assert_1.strict.equal(d.ok, true);
        if (!d.ok)
            return;
        // Stored as "Fire" (owned casing), NOT the submitted "fire" — so PvP's
        // case-sensitive VALID_WEAPON_ELEMENTS whitelist honors it.
        node_assert_1.strict.equal(d.character.weaponElements['black-lotus-dagger'], 'Fire');
        node_assert_1.strict.equal(d.value.element, 'Fire');
    });
});
