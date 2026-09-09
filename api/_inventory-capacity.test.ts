process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    INVENTORY_CAP,
    INVENTORY_FULL_ERROR,
    hasInventoryRoom,
    inventoryFullBlock,
    inventoryGrowthBlock,
    inventoryRoomLeft,
} from './_inventory-capacity.js';
import { forgeHollowGateKey } from './hollow-gate/_forge-key.js';
import { AURA_SPHERE_EVENT_ID, claimBuiltinEvent } from './events/_claim.js';
import { addOwned } from './craft/_forge.js';

/*
 * F7 step 2: a grant refuses at ACQUISITION instead of succeeding into nothing.
 *
 * Step 1 made the save validator non-destructive, so persistence can no longer
 * eat an item. That stopped the bleeding but left the cap advisory — it only
 * ever rose. This closes it at the other end: the paths a PLAYER initiates
 * refuse while the player still holds whatever would have produced the item.
 *
 * The rule is deliberately not applied to already-earned settlements (a boss
 * drop, a war reward): the fight is over, so refusing would strand a reward
 * rather than delay it, and step 1 already guarantees those persist. See the
 * handoff doc for that split.
 */

const bagOf = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'hoarder', level: 60,
    inventory: Array.from({ length: n }, (_, i) => `item-${i}`),
    itemStacks: [],
    ...over,
});

describe('the capacity rule', () => {
    it('counts distinct inventory entries and reports the room left', () => {
        assert.equal(inventoryRoomLeft(bagOf(0)), INVENTORY_CAP);
        assert.equal(inventoryRoomLeft(bagOf(INVENTORY_CAP - 3)), 3);
        assert.equal(inventoryRoomLeft(bagOf(INVENTORY_CAP)), 0);
        assert.equal(inventoryRoomLeft(bagOf(INVENTORY_CAP + 40)), 0, 'an over-cap veteran has no room, and no negative room');
    });

    it('refuses exactly at the cap, not one item early or late', () => {
        assert.equal(hasInventoryRoom(bagOf(INVENTORY_CAP - 1), 1), true);
        assert.equal(hasInventoryRoom(bagOf(INVENTORY_CAP), 1), false);
        assert.equal(hasInventoryRoom(bagOf(INVENTORY_CAP - 2), 3), false, 'a multi-item grant needs room for all of it');
    });

    it('returns one refusal shape every path can hand back', () => {
        assert.equal(inventoryFullBlock(bagOf(10)), null);
        const block = inventoryFullBlock(bagOf(INVENTORY_CAP));
        assert.equal(block?.status, 409);
        assert.equal(block?.error, INVENTORY_FULL_ERROR);
        assert.equal(block?.reason, 'inventory-full');
    });

    it('treats a zero-item grant as always allowed', () => {
        assert.equal(hasInventoryRoom(bagOf(INVENTORY_CAP + 99), 0), true);
    });
});

describe('player-initiated grants refuse before spending anything', () => {
    it('the Hollow Gate key forge is NOT capacity-gated, because its output is stackable', () => {
        // A full bag must not lock the dive. `hollow-gate-key` is stackable, so
        // it lands in itemStacks and costs no slot — gating it charged a
        // phantom cost and put the whole Hollow Gate behind deleting gear.
        const full = bagOf(INVENTORY_CAP, { fateShards: 9_999 });
        const out = forgeHollowGateKey(full, 'fateShards');
        assert.equal(out.ok, true, 'a full bag cannot block a key that occupies no slot');
        if (out.ok !== true) return;
        assert.equal((out.character.inventory as string[]).length, INVENTORY_CAP, 'inventory[] is untouched');
        assert.deepEqual(out.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
        assert.equal(out.character.fateShards, 9_989, 'and the shards were spent exactly once');
    });

    it('stacks a second forged key rather than starting a new entry', () => {
        const out = forgeHollowGateKey(
            bagOf(10, { fateShards: 9_999, itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }] }),
            'fateShards',
        );
        assert.equal(out.ok, true);
        if (out.ok !== true) return;
        assert.deepEqual(out.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 3 }]);
    });

    it('a one-time event claim is not latched away on a full bag', () => {
        const full = bagOf(INVENTORY_CAP, { claimedCreatorEvents: [] });
        const out = claimBuiltinEvent(full, AURA_SPHERE_EVENT_ID) as { ok: boolean; reason?: string; character?: Record<string, unknown> };
        assert.equal(out.ok, false, 'refused rather than consumed');
        assert.equal(out.reason, 'inventory-full');
        // The claim stays available: nothing was written, so the player can take
        // it once they make room. Burning the latch here would destroy it.
        assert.deepEqual(full.claimedCreatorEvents, []);
    });

    it('judges a net-NEGATIVE action on its result, so crafting can still free the bag', () => {
        // The trap this replaces: a weapon craft burns 30-50 non-stackable
        // `hunt-*` materials to add one item, and a bag full of hunt materials is
        // exactly how a bag reaches the cap. A plain "is the bag full?" check
        // refused the one action that makes room.
        const full = bagOf(INVENTORY_CAP);
        const afterCraft = bagOf(INVENTORY_CAP - 39);           // -40 materials, +1 weapon
        assert.equal(inventoryGrowthBlock(full, afterCraft), null, 'a net-negative craft must go through');

        const afterPurchase = bagOf(INVENTORY_CAP + 5);          // a pure addition
        assert.equal(inventoryGrowthBlock(full, afterPurchase)?.reason, 'inventory-full');

        // Net-neutral is allowed too — nothing grew.
        assert.equal(inventoryGrowthBlock(full, bagOf(INVENTORY_CAP)), null);
    });

    it('lets an already-over-cap veteran keep shrinking their bag', () => {
        const over = bagOf(INVENTORY_CAP + 60);
        assert.equal(inventoryGrowthBlock(over, bagOf(INVENTORY_CAP + 20)), null, 'still net-negative');
        assert.equal(inventoryGrowthBlock(over, bagOf(INVENTORY_CAP + 61))?.reason, 'inventory-full', 'but cannot grow further');
    });

    it('never refuses while the result is inside the cap', () => {
        assert.equal(inventoryGrowthBlock(bagOf(0), bagOf(INVENTORY_CAP)), null);
        assert.equal(inventoryGrowthBlock(bagOf(INVENTORY_CAP - 1), bagOf(INVENTORY_CAP)), null);
    });

    it('a stackable output never consumes an inventory slot, which is why the gate is scoped', () => {
        // This is the property the endpoint's `kind === weapon || armor` scoping
        // rests on: supply and relic recipes are STACKABLE_OUTPUTS and land in
        // itemStacks. Gating them on a full inventory would refuse a ration craft
        // for a bag it never touches.
        const full = bagOf(INVENTORY_CAP, { itemStacks: [] });
        const stacked = addOwned(full, 'item-attack-pill', 2);
        assert.equal((stacked.inventory as string[]).length, INVENTORY_CAP, 'inventory[] is untouched');
        assert.equal((stacked.itemStacks as Array<{ itemId: string; count: number }>)[0]?.itemId, 'item-attack-pill');

        // A weapon/armor output is the opposite, and is what the gate covers.
        const direct = addOwned(bagOf(3), 'rustfang-kunai', 1);
        assert.equal((direct.inventory as string[]).length, 4, 'a non-stackable output does take a slot');
    });
});
