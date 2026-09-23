import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canCancelUnstartedPvpDuel, isCancelledUnstartedPvpDuel } from './pvp-cancellation.js';

const cancelled = {
    status: 'done', winner: 'draw', terminalReason: 'cancelled-unjoined',
    rewardAuthority: 'world', round: 1, actionsThisTurn: 0,
    joined: { p1: true, p2: false }, p1: { name: 'Alice' }, p2: { name: 'Bob' },
    log: ['Battle begins.', 'Alice cancelled the unstarted duel.'],
};

test('cancellation is offered only before an authorized casual duel begins', () => {
    const active = { ...cancelled, status: 'active', winner: null, terminalReason: undefined };
    assert.equal(canCancelUnstartedPvpDuel(active), true);
    assert.equal(canCancelUnstartedPvpDuel({ ...active, rewardAuthority: 'challenge' }), true);
    for (const patch of [
        { status: 'done' }, { rewardAuthority: undefined }, { rewardAuthority: 'ranked' },
        { rewardAuthority: 'clan-war' }, { ranked: true }, { rankedKind: 'player' },
        { playerRankedAuthorityVersion: 2 }, { kageDuelAuthority: {} }, { clanWarId: 'war' },
        { round: 2 }, { actionsThisTurn: 1 }, { turnStartedAt: 1 },
        { joined: { p1: true, p2: true } }, { joined: undefined },
    ]) assert.equal(canCancelUnstartedPvpDuel({ ...active, ...patch }), false, JSON.stringify(patch));
});

test('only explicit unstarted cancellations bypass battle settlement', () => {
    assert.equal(isCancelledUnstartedPvpDuel(cancelled), true);
    assert.equal(isCancelledUnstartedPvpDuel({ ...cancelled, terminalReason: undefined }), true);
    for (const patch of [
        { status: 'active' }, { winner: 'p1' }, { rewardAuthority: 'ranked' },
        { rewardAuthority: 'clan-war' }, { ranked: true }, { rankedKind: 'player' },
        { playerRankedAuthorityVersion: 2 }, { kageDuelAuthority: {} }, { clanWarId: 'war' },
        { round: 2 }, { actionsThisTurn: 1 }, { turnStartedAt: 1 },
        { joined: { p1: true, p2: true } }, { joined: undefined },
        { terminalReason: undefined, log: ['The duel ended in a draw.'] },
    ]) assert.equal(isCancelledUnstartedPvpDuel({ ...cancelled, ...patch }), false, JSON.stringify(patch));
});
