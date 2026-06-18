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
(0, node_test_1.describe)('validateVillageStateWrite — Hollow Gate 30-day timed unlock', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const kage = { seatedKage: 'rin' }; // matches `villager.callerName`
    const notKage = { callerName: 'jin', isAdmin: false, village: 'Leaf' };
    (0, node_test_1.it)('lets the seated Kage open the gate (~30 days, clamped)', async () => {
        const want = Date.now() + 30 * DAY;
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)({}, { hollowGateUnlockedUntil: want }, villager, kage);
        const until = next.hollowGateUnlockedUntil;
        node_assert_1.strict.ok(until >= Date.now() + 29 * DAY && until <= Date.now() + 31 * DAY, `until=${until}`);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('hollowGateUnlockedUntil')), false);
    });
    (0, node_test_1.it)('clamps a tampered far-future expiry to ~31 days', async () => {
        const want = Date.now() + 3650 * DAY; // ~10 years
        const { next } = await (0, _village_state_validate_js_1.validateVillageStateWrite)({}, { hollowGateUnlockedUntil: want }, villager, kage);
        node_assert_1.strict.ok(next.hollowGateUnlockedUntil <= Date.now() + 32 * DAY);
    });
    (0, node_test_1.it)('stacks another 30 days onto an already-active window (extend across writes)', async () => {
        const prevUntil = Date.now() + 10 * DAY;
        const prev = { hollowGateUnlockedUntil: prevUntil };
        const { next } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, { hollowGateUnlockedUntil: prevUntil + 30 * DAY }, villager, kage);
        const until = next.hollowGateUnlockedUntil;
        node_assert_1.strict.ok(until >= prevUntil + 29 * DAY && until <= prevUntil + 31 * DAY, `until=${until}`);
    });
    (0, node_test_1.it)('blocks a non-Kage from extending (pins to prev)', async () => {
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)({}, { hollowGateUnlockedUntil: Date.now() + 30 * DAY }, notKage, kage);
        node_assert_1.strict.equal(next.hollowGateUnlockedUntil, 0);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('only seatedKage may unlock')), true);
    });
    (0, node_test_1.it)('pins an active unlock when a non-admin write tries to lower it (immune to stale clobber)', async () => {
        const prevUntil = Date.now() + 20 * DAY;
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)({ hollowGateUnlockedUntil: prevUntil }, { hollowGateUnlockedUntil: 0 }, villager, kage);
        node_assert_1.strict.equal(next.hollowGateUnlockedUntil, prevUntil);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('decrease (admin only)')), true);
    });
    (0, node_test_1.it)('lets an admin re-lock early (lower the expiry)', async () => {
        const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)({ hollowGateUnlockedUntil: Date.now() + 20 * DAY }, { hollowGateUnlockedUntil: 0 }, admin, kage);
        node_assert_1.strict.equal(next.hollowGateUnlockedUntil, 0);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('decrease')), false);
    });
    (0, node_test_1.it)('posts a one-time re-seal notice once the window lapses, then dedupes', async () => {
        const expired = Date.now() - 1000;
        const prev = { hollowGateUnlockedUntil: expired };
        const first = await (0, _village_state_validate_js_1.validateVillageStateWrite)(prev, { hollowGateUnlockedUntil: expired }, villager, null);
        const posts1 = (first.next.noticePosts ?? []);
        node_assert_1.strict.equal(posts1.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 1);
        node_assert_1.strict.equal(first.next.hollowGateExpiryNoticedFor, expired);
        // A second write after the marker is set must not post a duplicate.
        const second = await (0, _village_state_validate_js_1.validateVillageStateWrite)(first.next, { hollowGateUnlockedUntil: expired }, villager, null);
        const posts2 = (second.next.noticePosts ?? []);
        node_assert_1.strict.equal(posts2.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 1);
    });
    (0, node_test_1.it)('does not post a re-seal notice when the Kage re-opens on the same write', async () => {
        const expired = Date.now() - 1000;
        const { next } = await (0, _village_state_validate_js_1.validateVillageStateWrite)({ hollowGateUnlockedUntil: expired }, { hollowGateUnlockedUntil: Date.now() + 30 * DAY }, villager, kage);
        const posts = (next.noticePosts ?? []);
        node_assert_1.strict.equal(posts.filter((p) => String(p.id).startsWith('hg-reseal-')).length, 0);
    });
});
