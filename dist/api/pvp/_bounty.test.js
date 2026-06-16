"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Decision-logic guard for the PvP bounty board (api/pvp/bounty.ts).
 * Tests the pure placement gates and board math in _bounty.ts.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _bounty_js_1 = require("./_bounty.js");
const NOW = 1_700_000_000_000;
function placeInput(over = {}) {
    return {
        placerName: 'Rill',
        targetName: 'Kenji',
        amount: 5_000,
        placerRyo: 1_000_000,
        targetExists: true,
        board: (0, _bounty_js_1.emptyBoard)(),
        ...over,
    };
}
(0, node_test_1.describe)('placeBounty', () => {
    (0, node_test_1.it)('places a fresh bounty on a valid target', () => {
        const r = (0, _bounty_js_1.placeBounty)(placeInput(), NOW);
        node_assert_1.strict.equal(r.ok, true);
        if (!r.ok)
            return;
        const b = (0, _bounty_js_1.findBounty)(r.board, 'Kenji');
        node_assert_1.strict.equal(b?.amount, 5_000);
        node_assert_1.strict.deepEqual(b?.contributors, ['rill']);
    });
    (0, node_test_1.it)('accumulates onto an existing head and dedupes contributors', () => {
        const first = (0, _bounty_js_1.placeBounty)(placeInput(), NOW);
        node_assert_1.strict.ok(first.ok);
        if (!first.ok)
            return;
        const second = (0, _bounty_js_1.placeBounty)(placeInput({ board: first.board, amount: 3_000 }), NOW + 1);
        node_assert_1.strict.ok(second.ok);
        if (!second.ok)
            return;
        const b = (0, _bounty_js_1.findBounty)(second.board, 'Kenji');
        node_assert_1.strict.equal(b?.amount, 8_000);
        node_assert_1.strict.deepEqual(b?.contributors, ['rill'], 'same placer not duplicated');
    });
    (0, node_test_1.it)('rejects bountying yourself', () => {
        node_assert_1.strict.equal((0, _bounty_js_1.placeBounty)(placeInput({ targetName: 'Rill' }), NOW).ok, false);
    });
    (0, node_test_1.it)('rejects a nonexistent target', () => {
        node_assert_1.strict.equal((0, _bounty_js_1.placeBounty)(placeInput({ targetExists: false }), NOW).ok, false);
    });
    (0, node_test_1.it)('enforces min and max per placement', () => {
        node_assert_1.strict.equal((0, _bounty_js_1.placeBounty)(placeInput({ amount: _bounty_js_1.BOUNTY_MIN_PLACE - 1 }), NOW).ok, false);
        node_assert_1.strict.equal((0, _bounty_js_1.placeBounty)(placeInput({ amount: _bounty_js_1.BOUNTY_MAX_PLACE + 1 }), NOW).ok, false);
    });
    (0, node_test_1.it)('rejects when the placer cannot afford it', () => {
        node_assert_1.strict.equal((0, _bounty_js_1.placeBounty)(placeInput({ amount: 50_000, placerRyo: 49_999 }), NOW).ok, false);
    });
    (0, node_test_1.it)('rejects pushing a head over the per-target cap', () => {
        const board = { bounties: [{ target: 'Kenji', amount: _bounty_js_1.BOUNTY_MAX_PER_TARGET, contributors: ['x'], updatedAt: NOW }] };
        node_assert_1.strict.equal((0, _bounty_js_1.placeBounty)(placeInput({ board, amount: _bounty_js_1.BOUNTY_MIN_PLACE }), NOW).ok, false);
    });
});
(0, node_test_1.describe)('claimBounty', () => {
    (0, node_test_1.it)('returns the pool and removes the head', () => {
        const placed = (0, _bounty_js_1.placeBounty)(placeInput({ amount: 12_000 }), NOW);
        node_assert_1.strict.ok(placed.ok);
        if (!placed.ok)
            return;
        const r = (0, _bounty_js_1.claimBounty)(placed.board, 'Kenji');
        node_assert_1.strict.equal(r.ok, true);
        if (!r.ok)
            return;
        node_assert_1.strict.equal(r.amount, 12_000);
        node_assert_1.strict.equal((0, _bounty_js_1.findBounty)(r.board, 'Kenji'), undefined, 'head cleared after claim');
    });
    (0, node_test_1.it)('rejects claiming a head with no bounty', () => {
        node_assert_1.strict.equal((0, _bounty_js_1.claimBounty)((0, _bounty_js_1.emptyBoard)(), 'Ghost').ok, false);
    });
});
(0, node_test_1.describe)('normalizeBoard', () => {
    (0, node_test_1.it)('repairs malformed/zero entries and caps the list', () => {
        const board = (0, _bounty_js_1.normalizeBoard)({ bounties: [
                { target: 'A', amount: 5_000, contributors: ['x', 'x'], updatedAt: NOW },
                { target: 'B', amount: 0, contributors: [], updatedAt: NOW }, // dropped (0)
                { amount: 100 }, // dropped (no target)
            ] });
        node_assert_1.strict.equal(board.bounties.length, 1);
        node_assert_1.strict.equal(board.bounties[0].target, 'A');
        node_assert_1.strict.deepEqual(board.bounties[0].contributors, ['x'], 'contributors deduped');
    });
    (0, node_test_1.it)('returns an empty board for junk input', () => {
        node_assert_1.strict.deepEqual((0, _bounty_js_1.normalizeBoard)(null), (0, _bounty_js_1.emptyBoard)());
        node_assert_1.strict.deepEqual((0, _bounty_js_1.normalizeBoard)({ nope: true }), (0, _bounty_js_1.emptyBoard)());
    });
});
