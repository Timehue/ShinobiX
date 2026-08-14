/**
 * Decision-logic guard for the PvP bounty board (api/pvp/bounty.ts).
 * Tests the pure placement gates and board math in _bounty.ts.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    placeBounty, claimBounty, findBounty, normalizeBoard, emptyBoard,
    BOUNTY_MIN_PLACE, BOUNTY_MAX_PLACE, BOUNTY_MAX_PER_TARGET,
    type BountyBoard, type PlaceInput,
} from './_bounty.js';

const NOW = 1_700_000_000_000;

function placeInput(over: Partial<PlaceInput> = {}): PlaceInput {
    return {
        placerName: 'Rill',
        targetName: 'Kenji',
        amount: 5_000,
        placerRyo: 1_000_000,
        targetExists: true,
        board: emptyBoard(),
        ...over,
    };
}

describe('placeBounty', () => {
    it('places a fresh bounty on a valid target', () => {
        const r = placeBounty(placeInput(), NOW);
        assert.equal(r.ok, true);
        if (!r.ok) return;
        const b = findBounty(r.board, 'Kenji');
        assert.equal(b?.amount, 5_000);
        assert.deepEqual(b?.contributors, ['rill']);
    });
    it('accumulates onto an existing head and dedupes contributors', () => {
        const first = placeBounty(placeInput(), NOW);
        assert.ok(first.ok);
        if (!first.ok) return;
        const second = placeBounty(placeInput({ board: first.board, amount: 3_000 }), NOW + 1);
        assert.ok(second.ok);
        if (!second.ok) return;
        const b = findBounty(second.board, 'Kenji');
        assert.equal(b?.amount, 8_000);
        assert.deepEqual(b?.contributors, ['rill'], 'same placer not duplicated');
    });
    it('rejects bountying yourself', () => {
        assert.equal(placeBounty(placeInput({ targetName: 'Rill' }), NOW).ok, false);
    });
    it('rejects a nonexistent target', () => {
        assert.equal(placeBounty(placeInput({ targetExists: false }), NOW).ok, false);
    });
    it('enforces min and max per placement', () => {
        assert.equal(placeBounty(placeInput({ amount: BOUNTY_MIN_PLACE - 1 }), NOW).ok, false);
        assert.equal(placeBounty(placeInput({ amount: BOUNTY_MAX_PLACE + 1 }), NOW).ok, false);
    });
    it('rejects when the placer cannot afford it', () => {
        assert.equal(placeBounty(placeInput({ amount: 50_000, placerRyo: 49_999 }), NOW).ok, false);
    });
    it('rejects pushing a head over the per-target cap', () => {
        const board: BountyBoard = { bounties: [{ target: 'Kenji', amount: BOUNTY_MAX_PER_TARGET, contributors: ['x'], updatedAt: NOW }] };
        assert.equal(placeBounty(placeInput({ board, amount: BOUNTY_MIN_PLACE }), NOW).ok, false);
    });
});

describe('claimBounty', () => {
    it('returns the pool and removes the head', () => {
        const placed = placeBounty(placeInput({ amount: 12_000 }), NOW);
        assert.ok(placed.ok);
        if (!placed.ok) return;
        const r = claimBounty(placed.board, 'Kenji');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.amount, 12_000);
        assert.equal(findBounty(r.board, 'Kenji'), undefined, 'head cleared after claim');
    });
    it('rejects claiming a head with no bounty', () => {
        assert.equal(claimBounty(emptyBoard(), 'Ghost').ok, false);
    });
});

describe('normalizeBoard', () => {
    it('repairs malformed/zero entries and caps the list', () => {
        const board = normalizeBoard({ bounties: [
            { target: 'A', amount: 5_000, contributors: ['x', 'x'], updatedAt: NOW },
            { target: 'B', amount: 0, contributors: [], updatedAt: NOW }, // dropped (0)
            { amount: 100 },                                              // dropped (no target)
        ] });
        assert.equal(board.bounties.length, 1);
        assert.equal(board.bounties[0]!.target, 'A');
        assert.deepEqual(board.bounties[0]!.contributors, ['x'], 'contributors deduped');
    });
    it('returns an empty board for junk input', () => {
        assert.deepEqual(normalizeBoard(null), emptyBoard());
        assert.deepEqual(normalizeBoard({ nope: true }), emptyBoard());
    });
});
