import assert from 'node:assert/strict';
import test from 'node:test';
import { SHOWDOWN_ATTRITION_START } from '../../shared/pet-showdown-contract.js';
import { arenaResult, chooseArenaPets, parseArenaCommands, resolveArenaRound, sealArenaTeam } from './arena-showdown.js';
import {
    acknowledgeTacticsRound, advanceTacticsSession, concedeTacticsSession, createArenaSession, joinArenaSession,
    lockTacticsLeads, lockTacticsOrders, roomResult, tacticsView,
} from './session.js';
import { TacticsError } from './engine.js';

// Owner ruling 2026-10-26: Pet Arena fights with the players' real companions
// on the Coliseum engine, two on the field and two on the bench.
const pet = (id: string, level = 40, patch: Record<string, unknown> = {}) => ({
    id, name: `Pet ${id}`, element: 'Fire', role: 'assassin', rarity: 'rare', level,
    hp: 900, attack: 140, defense: 90, speed: 110,
    jutsus: [{ name: 'Ember Bite', power: 90, kind: 'damage' }], ...patch,
});
const character = (ids: string[], level = 40) => ({ name: 'owner', level: 60, pets: ids.map(id => pet(id, level)), activePetId: ids[0] });
const IDS = ['p1', 'p2', 'p3', 'p4'];

function room(aLevel = 40, bLevel = 40, bIds = IDS) {
    const a = sealArenaTeam(chooseArenaPets(character(IDS, aLevel), IDS), 'a');
    const b = sealArenaTeam(chooseArenaPets(character(bIds, bLevel), bIds), 'b');
    const session = createArenaSession('abcd1234', 'alice', a, 1234, 1_000);
    joinArenaSession(session, 'bob', b, 1_001);
    lockTacticsLeads(session, 'a', [0, 1], 1_002);
    lockTacticsLeads(session, 'b', [2, 3], 1_003);
    return session;
}
const guardAll = (session: ReturnType<typeof room>, seat: 'a' | 'b') =>
    (seat === 'a' ? session.arena!.player : session.arena!.enemy).filter(p => !p.benched && !p.ko).map(p => ({ kind: 'guard', petId: p.id }));

test('both seats bring their own sealed team, even when their pets share ids', () => {
    const session = room();
    assert.equal(session.phase, 'planning');
    const a = session.arena!.player.map(p => p.id), b = session.arena!.enemy.map(p => p.id);
    assert.deepEqual(a, IDS.map(id => `a:${id}`));
    assert.deepEqual(b, IDS.map(id => `b:${id}`));
    // Leads: seat A fields its first two, seat B its last two.
    assert.deepEqual(session.arena!.player.map(p => p.benched), [false, false, true, true]);
    assert.deepEqual(session.arena!.enemy.map(p => p.benched), [true, true, false, false]);
});

test('a real level changes the sealed stats', () => {
    const low = sealArenaTeam(chooseArenaPets(character(IDS, 5), IDS), 'a')[0];
    const high = sealArenaTeam(chooseArenaPets(character(IDS, 90), IDS), 'a')[0];
    assert.equal(low.level, 5);
    assert.equal(high.level, 90);
    assert.notDeepEqual([low.maxHp, low.attack], [high.maxHp, high.attack]);
});

test('only four distinct carried companions can enter', () => {
    assert.throws(() => chooseArenaPets(character(IDS), IDS.slice(0, 3)), TacticsError);
    assert.throws(() => chooseArenaPets(character(IDS), ['p1', 'p1', 'p2', 'p3']), TacticsError);
    assert.throws(() => chooseArenaPets(character(IDS), ['p1', 'p2', 'p3', 'stranger']), TacticsError);
    const away = { ...character(IDS), pets: IDS.map((id, i) => pet(id, 40, i === 0 ? { expedition: { endsAt: Date.now() + 60_000 } } : {})) };
    assert.throws(() => chooseArenaPets(away, IDS), TacticsError);
});

test('a seat commands only its own companions', () => {
    const session = room();
    assert.throws(() => parseArenaCommands(session.arena!, 'a', [{ kind: 'guard', petId: 'b:p3' }]), TacticsError);
    assert.throws(() => parseArenaCommands(session.arena!, 'b', [{ kind: 'guard', petId: 'a:p1' }]), TacticsError);
    assert.deepEqual(parseArenaCommands(session.arena!, 'b', [{ kind: 'guard', petId: 'b:p3' }]), [{ kind: 'guard', petId: 'b:p3' }]);
});

test('a round resolves once both seats lock, and seat B sees the same fight from its side', () => {
    const session = room();
    const target = (seat: 'a' | 'b') => (seat === 'a' ? session.arena!.enemy : session.arena!.player).find(p => !p.benched)!.id;
    const strike = (seat: 'a' | 'b') => (seat === 'a' ? session.arena!.player : session.arena!.enemy)
        .filter(p => !p.benched).map(p => ({ kind: 'move', petId: p.id, moveIndex: 0, targetId: target(seat) }));
    lockTacticsOrders(session, 'a', 1, strike('a'), 2_000);
    assert.equal(session.phase, 'planning', 'one seat locked is not a round');
    lockTacticsOrders(session, 'b', 1, strike('b'), 2_001);
    assert.equal(session.phase, 'playback');
    assert.equal(session.arena!.round, 1);

    const viewA = tacticsView(session, 'a', 2_002), viewB = tacticsView(session, 'b', 2_002);
    assert.equal(viewA.engine, 'showdown-v1');
    assert.deepEqual(viewA.battle.player.map(p => p.id), viewB.battle.enemy.map(p => p.id));
    assert.deepEqual(viewA.battle.enemy.map(p => p.id), viewB.battle.player.map(p => p.id));
    assert.equal(viewA.battle.enemyTeamName, 'bob');
    assert.equal(viewB.battle.enemyTeamName, 'alice');
    const [roundA] = viewA.transcript, [roundB] = viewB.transcript;
    assert.equal(roundA.events.length, roundB.events.length);
    roundA.events.forEach((event, i) => {
        const mirrored = roundB.events[i];
        if (event.t === 'action') {
            assert.equal(mirrored.t, 'action');
            if (mirrored.t === 'action') {
                assert.equal(mirrored.actorId, event.actorId);
                assert.notEqual(mirrored.actorSide, event.actorSide);
            }
        }
    });
    // Seat B is told nothing about seat A's orders.
    assert.equal(viewB.ownCommands, null);
    acknowledgeTacticsRound(session, 'a', 1, 2_003);
    acknowledgeTacticsRound(session, 'b', 1, 2_004);
    assert.equal(session.phase, 'planning');
});

test('a locked round is immutable; a matching retry is accepted', () => {
    const session = room();
    const orders = guardAll(session, 'a');
    lockTacticsOrders(session, 'a', 1, orders, 2_000);
    lockTacticsOrders(session, 'a', 1, orders, 2_001);
    assert.throws(() => lockTacticsOrders(session, 'a', 1, [], 2_002), /already locked/);
});

test('in Pet Arena a mutual wipe is a draw, not a seat-A win', () => {
    const session = room();
    const arena = session.arena!;
    arena.round = SHOWDOWN_ATTRITION_START + 10;
    for (const p of [...arena.player, ...arena.enemy]) { p.hp = 1; if (p.benched) { p.ko = true; p.hp = 0; } }
    const { result } = resolveArenaRound(arena, guardAll(session, 'a') as never, guardAll(session, 'b') as never);
    assert.equal(result, 'draw');
    assert.equal(arenaResult(arena), 'draw');
});

test('missed rounds and concession still decide a room', () => {
    const session = room();
    for (let i = 0; i < 3; i += 1) {
        session.deadline = 0;
        advanceTacticsSession(session, 10_000 + i);
        if (session.phase === 'playback') { session.deadline = 0; advanceTacticsSession(session, 20_000 + i); }
    }
    assert.equal(roomResult(session), 'draw', 'both seats missed three rounds');
    // The battle itself ends too, so both screens reach their result panel.
    assert.equal(session.arena!.finished, true);
    assert.equal(session.arena!.pvpDraw, true);

    const conceded = room();
    concedeTacticsSession(conceded, 'b');
    assert.equal(roomResult(conceded), 'a');
    assert.equal(tacticsView(conceded, 'a', 3_000).result, 'win');
    assert.equal(tacticsView(conceded, 'b', 3_000).result, 'loss');
    assert.equal(conceded.arena!.finished, true);
    assert.equal(conceded.arena!.outcome, 'win', 'seat A\'s view of a seat-B concession');
});
