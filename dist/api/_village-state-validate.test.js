"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _village_state_validate_js_1 = require("./_village-state-validate.js");
// Audit #16 lockdown (village twin): net-new treasury.items must come from the
// atomic /api/village/treasury/donate endpoint. The save blob may only
// RE-ASSERT the current items or REMOVE them (Kage withdrawals/sends).
// Currency caps are unchanged — daily-agenda / other gameplay rewards still
// credit currencies via the save blob, so currencies are NOT hard-blocked.
//
// Treasury-only writes with kageState=null exercise no IO (the notice/silence
// and KV paths are gated behind other incoming fields).
const villager = { callerName: 'rin', isAdmin: false, village: 'Leaf' };
const admin = { callerName: '', isAdmin: true, village: 'Leaf' };
function stateWith(items, currency = {}) {
    return { treasury: { ...currency, items } };
}
function items(next) {
    return next.treasury.items;
}
(0, node_test_1.describe)('validateVillageStateWrite — treasury.items lockdown (#16)', () => {
    (0, node_test_1.it)('allows a verbatim re-assert of the existing items', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([{ itemId: 'ration', count: 2 }]), villager, null);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'ration', count: 2 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
    (0, node_test_1.it)('allows withdrawing items (counts only go down)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 2 }]);
        const { next } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([]), villager, null);
        node_assert_1.strict.deepEqual(items(next), []);
    });
    (0, node_test_1.it)('rejects a brand-new itemId (mint) and reverts to prev', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([{ itemId: 'ration', count: 1 }, { itemId: 'forbidden-scroll', count: 1 }]), villager, null);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'ration', count: 1 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('forbidden-scroll')), true);
    });
    (0, node_test_1.it)('rejects raising an existing item count (mint) and reverts', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([{ itemId: 'ration', count: 50 }]), villager, null);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'ration', count: 1 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), true);
    });
    (0, node_test_1.it)('lets admin add items (bypass)', async () => {
        const prev = stateWith([{ itemId: 'ration', count: 1 }]);
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([{ itemId: 'ration', count: 1 }, { itemId: 'gift', count: 1 }]), admin, null);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'ration', count: 1 }, { itemId: 'gift', count: 1 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
});
(0, node_test_1.describe)('validateVillageStateWrite — currency lockdown (#17, step 1c)', () => {
    const admin = { callerName: '', isAdmin: true, village: 'Leaf' };
    (0, node_test_1.it)('blocks a non-admin village-treasury currency increase (credit-without-debit)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([], { ryo: 1_000_000 }), villager, null);
        node_assert_1.strict.equal(next.treasury.ryo, 0); // kept at prev, not credited
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.ryo increase via save blob blocked')), true);
    });
    (0, node_test_1.it)('blocks the agenda-style honorSeals increase too (now credited via the endpoint)', async () => {
        const prev = stateWith([], { honorSeals: 0 });
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([], { honorSeals: 15 }), villager, null);
        node_assert_1.strict.equal(next.treasury.honorSeals, 0);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.honorSeals increase via save blob blocked')), true);
    });
    (0, node_test_1.it)('allows a zero-delta re-assert (post-endpoint the client re-saves the credited value)', async () => {
        const prev = stateWith([], { ryo: 1500, honorSeals: 15 });
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([], { ryo: 1500, honorSeals: 15 }), villager, null);
        node_assert_1.strict.equal(next.treasury.ryo, 1500);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('increase via save blob blocked')), false);
    });
    (0, node_test_1.it)('allows an admin to increase village currency (admin bypass)', async () => {
        const prev = stateWith([], { ryo: 0 });
        const { next } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, stateWith([], { ryo: 1500 }), admin, null);
        node_assert_1.strict.equal(next.treasury.ryo, 1500);
    });
});
