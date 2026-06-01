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
(0, node_test_1.describe)('validateClanSaveWrite — currency caps unchanged by the lockdown', () => {
    (0, node_test_1.it)('still caps a ryo increase at the per-write ceiling (not hard-blocked)', () => {
        const prev = clanWith([], { ryo: 0 });
        const { next } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { ryo: 1_000_000 }), member);
        node_assert_1.strict.equal(next.treasury.ryo, 50_000); // before(0) + cap(50_000)
    });
    (0, node_test_1.it)('still allows a warSupply increase within cap (war-earned, save-blob path)', () => {
        const prev = clanWith([], { warSupply: 10 });
        const { next } = (0, _clan_save_validate_js_1.validateClanSaveWrite)(prev, clanWith([], { warSupply: 60 }), member);
        node_assert_1.strict.equal(next.treasury.warSupply, 60); // +50 within cap 100
    });
});
