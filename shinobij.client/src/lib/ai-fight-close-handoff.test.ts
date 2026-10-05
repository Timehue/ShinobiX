import assert from 'node:assert/strict';
import test from 'node:test';
import { aiFightCloseNavigationState, beginAiFightClose, consumeCommittedAiFightClose } from './ai-fight-close-handoff';

test('a settled close waits for the closed commit and is delivered exactly once', () => {
    const close = { playerKey: 'kaze', requestId: 7, returnScreen: 'hospital' };
    const pending = { current: close as typeof close | null };
    const scope = { open: true, playerKey: 'kaze', requestId: 7 };
    assert.equal(consumeCommittedAiFightClose(pending, scope), null);
    assert.equal(pending.current, close);
    assert.equal(consumeCommittedAiFightClose(pending, { ...scope, open: false }), close);
    assert.equal(consumeCommittedAiFightClose(pending, { ...scope, open: false }), null);
});

test('account changes and newer requests retire an old close without navigation', () => {
    for (const scope of [
        { open: false, playerKey: 'other', requestId: 7 },
        { open: false, playerKey: 'kaze', requestId: 8 },
    ]) {
        const pending = { current: { playerKey: 'kaze', requestId: 7, returnScreen: 'worldMap' } as { playerKey: string; requestId: number; returnScreen: string } | null };
        assert.equal(consumeCommittedAiFightClose(pending, scope), null);
        assert.equal(pending.current, null);
    }
});

test('a new request can close after superseding the previous uncommitted handoff', () => {
    const closingRequest = { current: null as number | null };
    assert.equal(beginAiFightClose(closingRequest, 7), true);
    assert.equal(beginAiFightClose(closingRequest, 7), false, 'duplicate Return stays suppressed');
    const pending = { current: { playerKey: 'kaze', requestId: 7, returnScreen: 'worldMap' } as { playerKey: string; requestId: number; returnScreen: string } | null };
    assert.equal(consumeCommittedAiFightClose(pending, { open: true, playerKey: 'kaze', requestId: 8 }), null);
    assert.equal(pending.current, null, 'the new fight cancels the old navigation');
    assert.equal(beginAiFightClose(closingRequest, 8), true, 'the retired handoff cannot block the newer fight');
    assert.equal(beginAiFightClose(closingRequest, 8), false, 'the newer fight still suppresses duplicate Return');
});

test('App waits for both guard commits and cancels a return superseded by a queued fight', () => {
    let requestId = 7;
    const pending = { playerKey: 'kaze', generation: 2, returnScreen: 'hospital', isCurrent: () => requestId === 7 };
    const scope = { playerKey: 'kaze', generation: 2, sealedFightOpen: true, missionBattleActive: true };
    assert.equal(aiFightCloseNavigationState(pending, scope), 'wait');
    assert.equal(aiFightCloseNavigationState(pending, { ...scope, sealedFightOpen: false }), 'wait');
    assert.equal(aiFightCloseNavigationState(pending, { ...scope, sealedFightOpen: false, missionBattleActive: false }), 'ready');
    requestId = 8;
    assert.equal(aiFightCloseNavigationState(pending, scope), 'discard', 'a queued fight cancels the return while still open');
    assert.equal(aiFightCloseNavigationState(pending, { ...scope, sealedFightOpen: false, missionBattleActive: false }), 'discard', 'ending that newer fight must not revive the old return');
});

test('leaving and rejoining the same account cannot revive its old pending return', () => {
    const pending = { playerKey: 'kaze', generation: 2, returnScreen: 'worldMap', isCurrent: () => true };
    assert.equal(aiFightCloseNavigationState(pending, {
        playerKey: 'kaze', generation: 4, sealedFightOpen: false, missionBattleActive: false,
    }), 'discard');
});
