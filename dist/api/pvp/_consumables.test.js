"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Server-authoritative PvP consumable budget — the Rejuvenation Potion's
 * 2-uses-per-fight cap and the throwable/consumable "destroy on use" deduction.
 *
 * sealItemCharges (session.ts) seals each fighter's per-fight charges at create
 * time; move.ts decrements one per use and rejects at 0; deductUsedItems
 * (claim-rewards.ts) removes what was spent from the save at settlement.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const session_js_1 = require("./session.js");
const claim_rewards_js_1 = require("./claim-rewards.js");
(0, node_test_1.describe)('sealItemCharges — per-fight consumable budget', () => {
    (0, node_test_1.it)('caps the potion at 2 even when more are owned', () => {
        const char = {
            equipment: { potion: 'potion-rejuvenation' },
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 9 }],
        };
        node_assert_1.strict.equal((0, session_js_1.sealItemCharges)(char, char)['potion-rejuvenation'], 2);
    });
    (0, node_test_1.it)('potion owned 1 → only 1 charge (min(owned, 2))', () => {
        const char = {
            equipment: { potion: 'potion-rejuvenation' },
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 1 }],
        };
        node_assert_1.strict.equal((0, session_js_1.sealItemCharges)(char, char)['potion-rejuvenation'], 1);
    });
    (0, node_test_1.it)('seals throwables at the full owned count (no cap)', () => {
        const char = {
            equipment: { thrown: 'thrown-shuriken' },
            itemStacks: [{ itemId: 'thrown-shuriken', count: 5 }],
        };
        node_assert_1.strict.equal((0, session_js_1.sealItemCharges)(char, char)['thrown-shuriken'], 5);
    });
    (0, node_test_1.it)('seals all THREE combat-item slots (item1/2/3) at their owned counts', () => {
        const char = {
            equipment: {
                item1: 'item-smoke-bomb',
                item2: 'item-attack-pill',
                item3: 'item-defense-pill',
            },
            itemStacks: [
                { itemId: 'item-smoke-bomb', count: 3 },
                { itemId: 'item-attack-pill', count: 1 },
                { itemId: 'item-defense-pill', count: 7 },
            ],
        };
        const charges = (0, session_js_1.sealItemCharges)(char, char);
        node_assert_1.strict.equal(charges['item-smoke-bomb'], 3);
        node_assert_1.strict.equal(charges['item-attack-pill'], 1);
        node_assert_1.strict.equal(charges['item-defense-pill'], 7);
    });
    (0, node_test_1.it)('still seals a legacy single "item" slot (not-yet-migrated save)', () => {
        const char = {
            equipment: { item: 'item-attack-pill' },
            itemStacks: [{ itemId: 'item-attack-pill', count: 2 }],
        };
        node_assert_1.strict.equal((0, session_js_1.sealItemCharges)(char, char)['item-attack-pill'], 2);
    });
    (0, node_test_1.it)('owned count spans both inventory[] and itemStacks', () => {
        const char = { inventory: ['x', 'x'], itemStacks: [{ itemId: 'x', count: 3 }] };
        node_assert_1.strict.equal((0, session_js_1.ownedItemCount)(char, 'x'), 5);
    });
    (0, node_test_1.it)('NPC (no save inventory) still caps the potion at 2', () => {
        const equipChar = { equipment: { potion: 'potion-rejuvenation' } };
        node_assert_1.strict.equal((0, session_js_1.sealItemCharges)(equipChar, null)['potion-rejuvenation'], 2);
    });
    (0, node_test_1.it)('NPC non-potion consumables stay unsealed (reusable, prior AI behaviour)', () => {
        const equipChar = { equipment: { thrown: 'thrown-shuriken', item: 'item-smoke-bomb' } };
        const charges = (0, session_js_1.sealItemCharges)(equipChar, null);
        node_assert_1.strict.equal(charges['thrown-shuriken'], undefined);
        node_assert_1.strict.equal(charges['item-smoke-bomb'], undefined);
    });
});
(0, node_test_1.describe)('deductUsedItems — settlement consumption', () => {
    (0, node_test_1.it)('drains the counted stack first and drops emptied stacks', () => {
        const char = {
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 2 }, { itemId: 'k', count: 1 }],
            inventory: [],
        };
        const out = (0, claim_rewards_js_1.deductUsedItems)(char, { 'potion-rejuvenation': 2 });
        node_assert_1.strict.deepEqual(out.itemStacks, [{ itemId: 'k', count: 1 }]);
    });
    (0, node_test_1.it)('falls back to inventory[] copies once the stack runs out', () => {
        const char = { itemStacks: [{ itemId: 'x', count: 1 }], inventory: ['x', 'x'] };
        const out = (0, claim_rewards_js_1.deductUsedItems)(char, { x: 2 });
        node_assert_1.strict.deepEqual(out.itemStacks, []); // 1 drained from the stack
        node_assert_1.strict.deepEqual(out.inventory, ['x']); // 1 drained from inventory[]
    });
    (0, node_test_1.it)('never goes negative when more is reported used than owned', () => {
        const char = { itemStacks: [{ itemId: 'x', count: 1 }], inventory: [] };
        const out = (0, claim_rewards_js_1.deductUsedItems)(char, { x: 5 });
        node_assert_1.strict.deepEqual(out.itemStacks, []);
    });
    (0, node_test_1.it)('leaves unrelated items untouched', () => {
        const char = { itemStacks: [{ itemId: 'a', count: 3 }, { itemId: 'b', count: 4 }], inventory: ['c'] };
        const out = (0, claim_rewards_js_1.deductUsedItems)(char, { a: 1 });
        node_assert_1.strict.deepEqual(out.itemStacks, [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 4 }]);
        node_assert_1.strict.deepEqual(out.inventory, ['c']);
    });
});
