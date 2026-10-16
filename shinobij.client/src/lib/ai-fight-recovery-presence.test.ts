import assert from 'node:assert/strict';
import test from 'node:test';
import { aiFightRecoveryOwner, aiFightRecoveryPending, completeAiFightRecovery, aiFightRecoveryIsCurrent } from './ai-fight-recovery-presence';

test('an unprobed account blocks narrative until an empty or failed probe completes, and each retry claims again', () => {
    let state = { playerKey: 'alice', completedScope: '' };
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:0'), true);
    state = completeAiFightRecovery(state, 'alice', 'alice:0');
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:0'), false);
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:1'), true);
    state = completeAiFightRecovery(state, 'alice', 'alice:1');
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:1'), false);
    assert.equal(aiFightRecoveryPending(state, '', ''), false);
});

test('Alice to pending Bob to Alice cannot reuse Alice completion or accept late Bob completion', () => {
    let state = completeAiFightRecovery({ playerKey: 'alice', completedScope: '' }, 'alice', 'alice:0');
    assert.equal(aiFightRecoveryPending(state, 'bob', 'bob:0'), true, 'the new owner claims before layout commits');
    state = aiFightRecoveryOwner(state, 'bob');
    assert.equal(aiFightRecoveryPending(state, 'bob', 'bob:0'), true);
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:0'), true);
    state = aiFightRecoveryOwner(state, 'alice');
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:0'), true, 'returning Alice must probe again');
    state = completeAiFightRecovery(state, 'bob', 'bob:0');
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:0'), true, 'late Bob cannot release Alice');
    state = completeAiFightRecovery(state, 'alice', 'alice:0');
    assert.equal(aiFightRecoveryPending(state, 'alice', 'alice:0'), false);
});

test('unmount, account changes and replaced requests reject stale recovery completion, including an Alice ABA request', () => {
    assert.equal(aiFightRecoveryIsCurrent(true, 'alice', 7, 'alice', 7), true);
    assert.equal(aiFightRecoveryIsCurrent(false, 'alice', 7, 'alice', 7), false);
    assert.equal(aiFightRecoveryIsCurrent(true, 'alice', 7, 'bob', 7), false);
    assert.equal(aiFightRecoveryIsCurrent(true, 'alice', 7, 'alice', 9), false);
});
