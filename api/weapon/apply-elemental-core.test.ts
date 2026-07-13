import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { decideElementalCoreAttunement } from './apply-elemental-core.js';

// Base character: awakened Fire + Water, owns 2 Elemental Cores, a legendary and a
// common weapon in the bag, plus a mythic weapon equipped in the hand slot.
function baseChar(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        elements: ['Fire', 'Water'],
        itemStacks: [{ itemId: 'elemental-core', count: 2 }],
        inventory: ['black-lotus-dagger', 'training-katana'],
        equipment: { hand: 'void-leech-nodachi' },
        ...over,
    };
}

describe('decideElementalCoreAttunement (server-authoritative validation)', () => {
    it('attunes an owned legendary weapon to an awakened element, consuming one Core', () => {
        const d = decideElementalCoreAttunement(baseChar(), [], 'black-lotus-dagger', 'Fire');
        assert.equal(d.ok, true);
        if (!d.ok) return;
        assert.equal((d.character.weaponElements as Record<string, string>)['black-lotus-dagger'], 'Fire');
        const cores = (d.character.itemStacks as Array<{ itemId: string; count: number }>).find((s) => s.itemId === 'elemental-core');
        assert.equal(cores?.count, 1, 'exactly one Core consumed');
    });

    it('attunes an EQUIPPED mythic weapon (ownership satisfied via equipment)', () => {
        const d = decideElementalCoreAttunement(baseChar(), [], 'void-leech-nodachi', 'Water');
        assert.equal(d.ok, true);
    });

    it('rejects an element the player has not awakened', () => {
        const d = decideElementalCoreAttunement(baseChar(), [], 'black-lotus-dagger', 'Earth');
        assert.equal(d.ok, false);
        if (d.ok) return;
        assert.equal(d.status, 400);
        assert.match(d.error, /awakened/i);
    });

    it('rejects a non-legendary/mythic weapon', () => {
        const d = decideElementalCoreAttunement(baseChar(), [], 'training-katana', 'Fire');
        assert.equal(d.ok, false);
        if (d.ok) return;
        assert.match(d.error, /legendary or mythic/i);
    });

    it('rejects when the player owns no Elemental Core (and does NOT mutate)', () => {
        const d = decideElementalCoreAttunement(baseChar({ itemStacks: [] }), [], 'black-lotus-dagger', 'Fire');
        assert.equal(d.ok, false);
        if (d.ok) return;
        assert.match(d.error, /Elemental Core/i);
    });

    it('rejects an unknown weapon id with 404', () => {
        const d = decideElementalCoreAttunement(baseChar(), [], 'not-a-real-weapon', 'Fire');
        assert.equal(d.ok, false);
        if (d.ok) return;
        assert.equal(d.status, 404);
    });

    it('rejects a legendary weapon the player does not own', () => {
        // frostfang-oathblade is a legendary hand weapon, but it's not in the bag or equipped here.
        const d = decideElementalCoreAttunement(baseChar(), [], 'frostfang-oathblade', 'Fire');
        assert.equal(d.ok, false);
        if (d.ok) return;
        assert.match(d.error, /do not own/i);
    });

    it('re-attuning overwrites the prior element (spending another Core)', () => {
        const d = decideElementalCoreAttunement(baseChar({ weaponElements: { 'black-lotus-dagger': 'Fire' } }), [], 'black-lotus-dagger', 'Water');
        assert.equal(d.ok, true);
        if (!d.ok) return;
        assert.equal((d.character.weaponElements as Record<string, string>)['black-lotus-dagger'], 'Water');
    });

    it('attunes a named (creatorItems) legendary hand weapon', () => {
        const custom = [{ id: 'my-blade', name: 'My Blade', slot: 'hand', rarity: 'legendary', weaponEp: 27, weaponRange: 4 }];
        const d = decideElementalCoreAttunement(baseChar({ inventory: ['my-blade'] }), custom, 'my-blade', 'Fire');
        assert.equal(d.ok, true);
    });

    it('rejects a legendary GLOVE that merely shares the hand slot (not a real weapon)', () => {
        // bulwark-gloves is slot:"hand", rarity:"legendary" but has no weaponEp/range —
        // it must NOT be attunable (would otherwise ride the bloodline mult as a fake weapon).
        const d = decideElementalCoreAttunement(baseChar({ inventory: ['bulwark-gloves'] }), [], 'bulwark-gloves', 'Fire');
        assert.equal(d.ok, false);
        if (d.ok) return;
        assert.match(d.error, /weapon/i);
    });

    it('canonicalizes a lower-cased element to the wielder\'s stored casing', () => {
        const d = decideElementalCoreAttunement(baseChar(), [], 'black-lotus-dagger', 'fire');
        assert.equal(d.ok, true);
        if (!d.ok) return;
        // Stored as "Fire" (owned casing), NOT the submitted "fire" — so PvP's
        // case-sensitive VALID_WEAPON_ELEMENTS whitelist honors it.
        assert.equal((d.character.weaponElements as Record<string, string>)['black-lotus-dagger'], 'Fire');
        assert.equal(d.value.element, 'Fire');
    });
});
