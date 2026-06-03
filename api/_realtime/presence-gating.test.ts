import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackBlock, challengeBlock } from './presence-gating.js';
import type { OnlinePlayer } from './types.js';

const NOW = 1_000_000;
function player(over: Partial<OnlinePlayer> = {}): OnlinePlayer {
    return {
        name: 'target', displayName: 'Target', sector: 40, character: null,
        lastSeenAt: NOW, connectedAt: NOW, pendingAttacker: null,
        ...over,
    };
}

test('attackBlock: offline target → 404', () => {
    assert.deepEqual(attackBlock(null, NOW), { status: 404, error: 'Target not online.' });
});
test('attackBlock: online & idle → allowed', () => {
    assert.equal(attackBlock(player(), NOW), null);
});
test('attackBlock: traveling → 409', () => {
    const b = attackBlock(player({ travelingUntil: NOW + 5_000 }), NOW);
    assert.equal(b?.status, 409);
    assert.match(b!.error, /traveling/i);
});
test('attackBlock: expired travel window does NOT block', () => {
    assert.equal(attackBlock(player({ travelingUntil: NOW - 1 }), NOW), null);
});
test('attackBlock: already has pendingAttacker → 409', () => {
    assert.equal(attackBlock(player({ pendingAttacker: { name: 'x' } }), NOW)?.status, 409);
});
test('attackBlock: inBattle → 409', () => {
    assert.equal(attackBlock(player({ inBattle: true }), NOW)?.status, 409);
});

test('challengeBlock: offline target is NOT blocked (queued)', () => {
    assert.equal(challengeBlock(null, NOW), null);
});
test('challengeBlock: idle online → allowed', () => {
    assert.equal(challengeBlock(player(), NOW), null);
});
test('challengeBlock: traveling / inBattle / engaged → reason string', () => {
    assert.match(challengeBlock(player({ travelingUntil: NOW + 1 }), NOW)!, /traveling/i);
    assert.match(challengeBlock(player({ inBattle: true }), NOW)!, /battle/i);
    assert.match(challengeBlock(player({ pendingAttacker: {} }), NOW)!, /engaged/i);
});
