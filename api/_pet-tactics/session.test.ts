import test from 'node:test';
import assert from 'node:assert/strict';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import { TACTICS_PLAN_MS, TACTICS_PLAYBACK_MS } from '../../shared/pet-tactics-contract.js';
import { acknowledgeTacticsRound, advanceTacticsSession, createTacticsSession, joinTacticsSession, lockTacticsLeads, lockTacticsOrders, sessionSeat, tacticsView } from './session.js';
import { defaultOrders } from './engine.js';

const builds = () => ['starter-fire', 'starter-water', 'starter-lightning', 'starter-earth'].map(id => tacticsPreset(id));
function paired() {
    const s = createTacticsSession('aabbccdd', 'alice', builds(), 51, 1000);
    joinTacticsSession(s, 'bob', builds(), 1000); return s;
}
function planned() { const s = paired(); lockTacticsLeads(s, 'a', [0, 1], 1100); lockTacticsLeads(s, 'b', [0, 1], 1200); return s; }
test('preview hides locked leads, RNG, private orders and internal state from the other seat', () => {
    const s = paired(); lockTacticsLeads(s, 'a', [2, 3], 1100);
    const view = tacticsView(s, 'b', 1100);
    assert.equal(view.ready.opponent, true); assert.equal(view.ownLeads, null);
    assert.ok(view.enemy.every(p => p.slot === null));
    assert.equal('rng' in view, false); assert.equal('seed' in view, false); assert.equal('leads' in view, false);
    assert.throws(() => sessionSeat(s, 'mallory'));
    lockTacticsLeads(s, 'b', [0, 1], 1200); assert.equal(s.battle!.teams.a[2].slot, 0);
});
test('immutable locks recover after a restart; duplicate submissions cannot resolve twice or change orders', () => {
    let s = planned();
    const a = defaultOrders(s.battle!, 'a'), b = defaultOrders(s.battle!, 'b');
    lockTacticsOrders(s, 'a', 1, a, 1300);
    assert.equal(s.battle!.round, 0); assert.equal(tacticsView(s, 'b', 1300).ownOrders, null);
    assert.equal(tacticsView(s, 'b', 1300).ready.opponent, true);
    s = JSON.parse(JSON.stringify(s));
    lockTacticsOrders(s, 'a', 1, a, 1400);
    assert.throws(() => lockTacticsOrders(s, 'a', 1, a.map(o => ({ kind: 'rest', actorId: o.actorId })), 1400));
    lockTacticsOrders(s, 'b', 1, b, 1500); lockTacticsOrders(s, 'b', 1, b, 1600);
    assert.equal(s.battle!.round, 1); assert.equal(s.transcript.length, 1);
    assert.equal(tacticsView(s, 'b', 1600).transcript[0].events.filter(e => e.t === 'action').find(e => e.actorId === 'b-0')?.actorSide, 'player');
});
test('both seats share a planning start; fast playback alone never grants extra planning time', () => {
    const s = planned(); lockTacticsOrders(s, 'a', 1, defaultOrders(s.battle!, 'a'), 1300); lockTacticsOrders(s, 'b', 1, defaultOrders(s.battle!, 'b'), 1400);
    acknowledgeTacticsRound(s, 'a', 1, 1500); assert.equal(s.phase, 'playback');
    acknowledgeTacticsRound(s, 'b', 1, 1700); assert.equal(s.phase, 'planning'); assert.equal(s.deadline, 1700 + TACTICS_PLAN_MS);
    assert.throws(() => acknowledgeTacticsRound(s, 'a', 999, 1800));
});
test('deadlines default safely, do not depend on a live process, and three misses end the match', () => {
    let s = planned();
    for (let i = 0; i < 3; i++) {
        const now = s.deadline;
        lockTacticsOrders(s, 'a', i + 1, defaultOrders(s.battle!, 'a'), now - 1);
        s = JSON.parse(JSON.stringify(s)); advanceTacticsSession(s, now);
        if (i < 2) { assert.equal(s.phase, 'playback'); advanceTacticsSession(s, now + TACTICS_PLAYBACK_MS); }
    }
    assert.equal(s.phase, 'finished'); assert.equal(s.battle!.result, 'a'); assert.equal(s.missed.b, 3);
    assert.equal(tacticsView(s, 'b', s.deadline).result, 'loss');
});
test('late, foreign, duplicate actor and future round payloads cannot influence combat', () => {
    const s = planned(), before = structuredClone(s);
    for (const orders of [[{ kind: 'rest', actorId: 'b-0' }, { kind: 'rest', actorId: 'a-1' }], [{ kind: 'rest', actorId: 'a-0' }, { kind: 'rest', actorId: 'a-0' }]]) {
        assert.throws(() => lockTacticsOrders(s, 'a', 1, orders, 1300));
    }
    assert.throws(() => lockTacticsOrders(s, 'a', 2, defaultOrders(s.battle!, 'a'), 1300));
    assert.throws(() => lockTacticsOrders(s, 'a', 1, defaultOrders(s.battle!, 'a'), s.deadline));
    assert.deepEqual(s, before);
});
