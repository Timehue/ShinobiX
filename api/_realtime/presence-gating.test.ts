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
test('attackBlock: sub-Genin (level < 15) → 403 Academy protection', () => {
    const b = attackBlock(player({ character: { level: 10 } }), NOW);
    assert.equal(b?.status, 403);
    assert.match(b!.error, /Academy/i);
});
test('attackBlock: Genin (level 15) is NOT Academy-protected', () => {
    assert.equal(attackBlock(player({ character: { level: 15 } }), NOW), null);
});
test('attackBlock: unknown level (0 / missing) does NOT block', () => {
    assert.equal(attackBlock(player({ character: { level: 0 } }), NOW), null);
    assert.equal(attackBlock(player({ character: {} }), NOW), null);
});

test('challengeBlock: offline target is NOT blocked (queued)', () => {
    assert.equal(challengeBlock(null, NOW), null);
});
test('challengeBlock: idle online → allowed', () => {
    assert.equal(challengeBlock(player(), NOW), null);
});
test('challengeBlock: traveling / inBattle / engaged → 409 with reason', () => {
    const travel = challengeBlock(player({ travelingUntil: NOW + 1 }), NOW);
    assert.equal(travel?.status, 409);
    assert.match(travel!.error, /traveling/i);
    const battle = challengeBlock(player({ inBattle: true }), NOW);
    assert.equal(battle?.status, 409);
    assert.match(battle!.error, /battle/i);
    const engaged = challengeBlock(player({ pendingAttacker: {} }), NOW);
    assert.equal(engaged?.status, 409);
    assert.match(engaged!.error, /engaged/i);
});
test('challengeBlock: sub-Genin (level < 15) → 403 Academy protection', () => {
    const b = challengeBlock(player({ character: { level: 10 } }), NOW);
    assert.equal(b?.status, 403);
    assert.match(b!.error, /Academy/i);
});
test('challengeBlock: Genin (level 15) is NOT Academy-protected', () => {
    assert.equal(challengeBlock(player({ character: { level: 15 } }), NOW), null);
});
