import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    canCancelUnstartedPvpDuel,
    isCancelledUnstartedPvpDuel,
    isPvpNoShowForfeit,
    PVP_JOIN_WINDOW_MS,
    PVP_NO_SHOW_CLAIM_MS,
    pvpJoinDeadlineAt,
    pvpJoinWindowLapsed,
    pvpJoinWindowLapsedLogLine,
    pvpNoShowLogLine,
    pvpNoShowWinner,
} from './pvp-cancellation.js';

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

test('the join window runs from creation and covers only duels that can be cancelled', () => {
    const active = { ...cancelled, status: 'active', winner: null, terminalReason: undefined, createdAt: 1_000 };
    const deadline = 1_000 + PVP_JOIN_WINDOW_MS;
    assert.equal(pvpJoinDeadlineAt(active), deadline);
    assert.equal(pvpJoinWindowLapsed(active, deadline - 1), false);
    assert.equal(pvpJoinWindowLapsed(active, deadline), true);
    for (const patch of [
        { joined: { p1: true, p2: true } }, { rewardAuthority: 'ranked' }, { rewardAuthority: undefined },
        { clanWarId: 'war' }, { status: 'done' }, { createdAt: undefined }, { createdAt: 0 },
    ]) {
        assert.equal(pvpJoinDeadlineAt({ ...active, ...patch }), null, JSON.stringify(patch));
        assert.equal(pvpJoinWindowLapsed({ ...active, ...patch }, deadline * 2), false, JSON.stringify(patch));
    }
});

test('the called-off line names the fighter who never came, on either side', () => {
    assert.match(pvpJoinWindowLapsedLogLine(cancelled), /^Bob did not join/);
    assert.match(pvpJoinWindowLapsedLogLine({ ...cancelled, joined: { p1: false, p2: true } }), /^Alice did not join/);
});

test('a no-show loses only to a fighter who joined and is still there when the window ends', () => {
    const active = { ...cancelled, status: 'active', winner: null, terminalReason: undefined, createdAt: 1_000 };
    const deadline = 1_000 + PVP_JOIN_WINDOW_MS;
    assert.equal(pvpNoShowWinner(active, deadline - 1), null);
    assert.equal(pvpNoShowWinner(active, deadline), 'p1');
    assert.equal(pvpNoShowWinner({ ...active, joined: { p1: false, p2: true } }, deadline), 'p2');
    assert.equal(pvpNoShowWinner(active, deadline + PVP_NO_SHOW_CLAIM_MS - 1), 'p1');
    assert.equal(pvpNoShowWinner(active, deadline + PVP_NO_SHOW_CLAIM_MS), null);
    assert.equal(pvpNoShowWinner({ ...active, joined: { p1: false, p2: false } }, deadline), null);
    assert.equal(pvpNoShowWinner({ ...active, rewardAuthority: 'ranked' }, deadline), null);
    assert.match(pvpNoShowLogLine(active), /^Bob did not join in time and forfeits/);
});

test('a forfeit is a settled result, never a cancellation', () => {
    const forfeit = { ...cancelled, winner: 'p1', terminalReason: 'no-show' };
    assert.equal(isPvpNoShowForfeit(forfeit), true);
    assert.equal(isCancelledUnstartedPvpDuel(forfeit), false);
    assert.equal(isPvpNoShowForfeit(cancelled), false);
    assert.equal(isPvpNoShowForfeit({ ...forfeit, status: 'active' }), false);
    assert.equal(isPvpNoShowForfeit({ ...forfeit, winner: 'draw' }), false);
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
