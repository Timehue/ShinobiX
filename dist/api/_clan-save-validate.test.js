"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _clan_save_validate_js_1 = require("./_clan-save-validate.js");
// Audit #16 lockdown: net-new treasury.items must come from the atomic
// /api/clan/treasury/donate endpoint (which verifies ownership). The save blob
// may only RE-ASSERT the current items (migrated client re-saves the
// endpoint-credited treasury verbatim) or REMOVE them (withdrawals/sends).
// Currency caps are unchanged defense-in-depth and are spot-checked so the
// lockdown can't be confused with a currency-credit change (war/agenda/
// warSupply rewards still legitimately credit currencies via the save blob).
const member = { callerName: 'akira', isAdmin: false };
const admin = { callerName: '', isAdmin: true };
function clanWith(items, currency = {}) {
    return { name: 'Storm', founderName: 'Kaze', treasury: { ...currency, items } };
}
function items(next) {
    return next.treasury.items;
}
(0, node_test_1.describe)('validateClanSaveWrite — treasury.items lockdown (#16)', () => {
    (0, node_test_1.it)('allows a verbatim re-assert of the existing items (zero delta)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 3 }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([{ itemId: 'kunai', count: 3 }]), member);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'kunai', count: 3 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
    (0, node_test_1.it)('allows removing/withdrawing items (counts only go down)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 3 }, { itemId: 'scroll', count: 1 }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([{ itemId: 'kunai', count: 1 }]), member);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
    (0, node_test_1.it)('rejects a brand-new itemId (mint) and reverts to prev', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 1 }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([{ itemId: 'kunai', count: 1 }, { itemId: 'legendary-blade', count: 1 }]), member);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('legendary-blade')), true);
    });
    (0, node_test_1.it)('rejects raising the count of an existing item (mint) and reverts', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 1 }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([{ itemId: 'kunai', count: 99 }]), member);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), true);
    });
    (0, node_test_1.it)('lets admin add items (bypass)', () => {
        const prev = clanWith([{ itemId: 'kunai', count: 1 }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([{ itemId: 'kunai', count: 1 }, { itemId: 'gift', count: 2 }]), admin);
        node_assert_1.strict.deepEqual(items(next), [{ itemId: 'kunai', count: 1 }, { itemId: 'gift', count: 2 }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.items')), false);
    });
});
(0, node_test_1.describe)('validateClanSaveWrite — warHistory same-length content (#16 secondary)', () => {
    const founder = { callerName: 'kaze', isAdmin: false }; // matches founderName below
    function clanHist(hist) {
        return { name: 'Storm', founderName: 'Kaze', warHistory: hist };
    }
    function hist(next) {
        return next.warHistory;
    }
    (0, node_test_1.it)('allows a verbatim re-assert of warHistory by a regular member', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanHist([{ id: 'w1', result: 'Lost', warCrateId: '' }]), member);
        node_assert_1.strict.deepEqual(hist(next), [{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('warHistory')), false);
    });
    (0, node_test_1.it)('blocks a regular member rewriting an entry (mint) and reverts to prev', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanHist([{ id: 'w1', result: 'Won', warCrateId: 'crate-1' }]), member);
        node_assert_1.strict.deepEqual(hist(next), [{ id: 'w1', result: 'Lost', warCrateId: '' }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('warHistory in-place content edit')), true);
    });
    (0, node_test_1.it)('allows the Founder (admin-role) to change an entry at the same length (war-end at cap)', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost' }]);
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanHist([{ id: 'w2', result: 'Won', warCrateId: 'c2' }]), founder);
        node_assert_1.strict.deepEqual(hist(next), [{ id: 'w2', result: 'Won', warCrateId: 'c2' }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('warHistory in-place content edit')), false);
    });
    (0, node_test_1.it)('allows a full admin to change warHistory content', () => {
        const prev = clanHist([{ id: 'w1', result: 'Lost' }]);
        const { next } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanHist([{ id: 'w9', result: 'Won' }]), admin);
        node_assert_1.strict.deepEqual(hist(next), [{ id: 'w9', result: 'Won' }]);
    });
});
(0, node_test_1.describe)('validateClanSaveWrite — bootstrap (first clan write, #2)', () => {
    (0, node_test_1.it)('keeps founderName + self-membership when the founder creates the clan', () => {
        const ctx = { callerName: 'akira', isAdmin: false };
        const incoming = {
            name: 'Storm', village: 'Leaf', founderName: 'Akira', createdAt: 123,
            members: [{ name: 'Akira', isFounder: true }],
        };
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(null, incoming, ctx);
        node_assert_1.strict.equal(next.founderName, 'Akira');
        node_assert_1.strict.deepEqual(next.members, [{ name: 'Akira', isFounder: true }]);
        node_assert_1.strict.equal(next.createdAt, 123);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('founderName')), false);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('members illegal')), false);
    });
    (0, node_test_1.it)('matches a multi-word founder via safeName (Aka Ito → akaito)', () => {
        const ctx = { callerName: 'akaito', isAdmin: false };
        const incoming = { name: 'Storm', village: 'Leaf', founderName: 'Aka Ito', members: [{ name: 'Aka Ito', isFounder: true }] };
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(null, incoming, ctx);
        node_assert_1.strict.equal(next.founderName, 'Aka Ito');
        node_assert_1.strict.deepEqual(next.members, [{ name: 'Aka Ito', isFounder: true }]);
        node_assert_1.strict.equal(suppressed.length, 0);
    });
    (0, node_test_1.it)('does NOT let a non-founder bootstrap someone else as founder', () => {
        const ctx = { callerName: 'mallory', isAdmin: false };
        const incoming = { name: 'Storm', village: 'Leaf', founderName: 'Akira', members: [{ name: 'Akira', isFounder: true }] };
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(null, incoming, ctx);
        node_assert_1.strict.notEqual(next.founderName, 'Akira');
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('founderName')), true);
    });
    (0, node_test_1.it)('still pins founderName on an EXISTING clan (no bootstrap)', () => {
        const prev = { name: 'Storm', founderName: 'Kaze' };
        const ctx = { callerName: 'akira', isAdmin: false };
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, { name: 'Storm', founderName: 'Akira' }, ctx);
        node_assert_1.strict.equal(next.founderName, 'Kaze');
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('founderName')), true);
    });
    (0, node_test_1.it)('recognizes a stored multi-word founder on later writes (callerRole via safeName)', () => {
        // Founder "Aka Ito" kicks a member on a later (non-bootstrap) write.
        // Under the old lower() comparison "aka ito" !== slug "akaito", so the
        // founder was unrecognized and the kick reverted.
        const prev = { name: 'Storm', founderName: 'Aka Ito', members: [{ name: 'Aka Ito' }, { name: 'Grunt' }] };
        const ctx = { callerName: 'akaito', isAdmin: false };
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, { ...prev, members: [{ name: 'Aka Ito' }] }, ctx);
        node_assert_1.strict.deepEqual(next.members, [{ name: 'Aka Ito' }]);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('members illegal')), false);
    });
    (0, node_test_1.it)('does not relax treasury minting on bootstrap (war crate / currency stay locked)', () => {
        const ctx = { callerName: 'akira', isAdmin: false };
        const incoming = {
            name: 'Storm', village: 'Leaf', founderName: 'Akira',
            members: [{ name: 'Akira', isFounder: true }],
            treasury: { ryo: 999999, items: [{ itemId: 'legendary-blade', count: 1 }] },
        };
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(null, incoming, ctx);
        node_assert_1.strict.equal(next.treasury.ryo, 0);
        node_assert_1.strict.deepEqual(next.treasury.items, []);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury')), true);
    });
});
(0, node_test_1.describe)('validateClanSaveWrite — currency lockdown (#17, step 1a)', () => {
    (0, node_test_1.it)('blocks a non-admin clan ryo increase via the save blob (credit-without-debit)', () => {
        const prev = clanWith([], { ryo: 0 });
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { ryo: 1_000_000 }), member);
        node_assert_1.strict.equal(next.treasury.ryo, 0); // kept at prev, NOT credited
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.ryo increase via save blob blocked')), true);
    });
    (0, node_test_1.it)('blocks a non-admin special-currency increase too (e.g. fateShards)', () => {
        const prev = clanWith([], { fateShards: 3 });
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { fateShards: 99 }), member);
        node_assert_1.strict.equal(next.treasury.fateShards, 3);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.fateShards increase via save blob blocked')), true);
    });
    (0, node_test_1.it)('allows a zero-delta re-assert (post-donate the client re-saves the credited value)', () => {
        const prev = clanWith([], { ryo: 5000, fateShards: 2 });
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { ryo: 5000, fateShards: 2 }), member);
        node_assert_1.strict.equal(next.treasury.ryo, 5000);
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('increase via save blob blocked')), false);
    });
    (0, node_test_1.it)('allows an admin to increase clan currency (admin bypass)', () => {
        const prev = clanWith([], { ryo: 0 });
        const { next } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { ryo: 5000 }), admin);
        node_assert_1.strict.equal(next.treasury.ryo, 5000);
    });
    (0, node_test_1.it)('blocks a warSupply increase too (collected via /api/clan/territory/collect-supply, step 1b)', () => {
        const prev = clanWith([], { warSupply: 10 });
        const { next, suppressed } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { warSupply: 60 }), member);
        node_assert_1.strict.equal(next.treasury.warSupply, 10); // kept at prev, not credited
        node_assert_1.strict.equal(suppressed.some((s) => s.includes('treasury.warSupply increase via save blob blocked')), true);
    });
    (0, node_test_1.it)('allows an admin warSupply increase + a member decrease (spend) unchanged', () => {
        const prevAdmin = clanWith([], { warSupply: 0 });
        node_assert_1.strict.equal((0, _clan_save_validate_js_1.validateClanSaveWrite)(prevAdmin, clanWith([], { warSupply: 500 }), admin).next.treasury.warSupply, 500);
        const prevSpend = clanWith([], { warSupply: 100 });
        const founderCtx = { callerName: 'kaze', isAdmin: false }; // founderName 'Kaze' → admin-role
        node_assert_1.strict.equal((0, _clan_save_validate_js_1.validateClanSaveWrite)(prevSpend, clanWith([], { warSupply: 0 }), founderCtx).next.treasury.warSupply, 0);
    });
});
