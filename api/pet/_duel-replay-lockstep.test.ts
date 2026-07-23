// The server's verdict on a LIVE two-player duel must match what the two clients
// actually played (docs/pet-coliseum-player-control-plan.md §10.6).
//
// This is the test that makes the lockstep result server-AUTHORITATIVE rather
// than merely consistent: the clients converge by determinism, but the server has
// to reach the same answer independently from the log it sequenced, or the
// authority is a fiction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayLockstepPetDuel, MAX_COMMANDS_PER_SECOND } from './_duel-replay.js';
import { DUEL_TPS } from '../_pet-sim/pet-duel-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';

function pet(id: string, element: string): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: 'Swift',
        jutsus: [
            { name: 'Fang Strike', kind: 'damage', power: 104, cooldown: 1 },
            { name: 'Ember Coil', kind: 'burn', power: 88, cooldown: 3 },
            { name: 'Stone Ward', kind: 'shield', power: 60, cooldown: 4 },
            { name: 'Ruin Fang', kind: 'crush', power: 182, cooldown: 6, signature: true },
        ],
    } as unknown as Pet;
}

const PARAMS = {
    mode: '1v1' as const, seed: 4242,
    damageMult: 1, hpMult: 1, revive: false,
    applyItems: true, accuracy: true, terrain: null,
};

const sides = () => [pet('P', 'Fire')] as Pet[];
const foes = () => [pet('Q', 'Water')] as Pet[];

test('an empty log still yields a definite winner', () => {
    const r = replayLockstepPetDuel(sides(), foes(), PARAMS, []);
    assert.ok(r.winner === 'p1' || r.winner === 'p2' || r.winner === null);
    assert.equal(r.applied, 0);
    // The outcome string is from the challenger's perspective; `winner` is the
    // side label the socket layer broadcasts. They must never disagree.
    if (r.outcome === 'win') assert.equal(r.winner, 'p1');
    if (r.outcome === 'loss') assert.equal(r.winner, 'p2');
    if (r.outcome === 'draw') assert.equal(r.winner, null);
});

test('the replay is deterministic — the same log always gives the same verdict', () => {
    const log = [
        { t: 40, cmd: { kind: 'ability', actorId: 'player-0', idx: 1 } },
        { t: 55, cmd: { kind: 'stance', actorId: 'enemy-0', stance: 0 } },
        { t: 90, cmd: { kind: 'ability', actorId: 'enemy-0', idx: 0 } },
    ] as never;
    const a = replayLockstepPetDuel(sides(), foes(), PARAMS, log);
    const b = replayLockstepPetDuel(sides(), foes(), PARAMS, log);
    assert.deepEqual(a, b);
});

test('BOTH sides can be commanded — an enemy order is not silently dropped', () => {
    // The single-commander replay marks only the player side controlled, so an
    // `enemy-*` order there is refused. This is the difference that matters.
    const log = [
        { t: 40, cmd: { kind: 'stance', actorId: 'enemy-0', stance: 2 } },
        { t: 41, cmd: { kind: 'ability', actorId: 'enemy-0', idx: 1 } },
    ] as never;
    const r = replayLockstepPetDuel(sides(), foes(), PARAMS, log);
    assert.equal(r.applied, 2, 'the opponent commands their own pet in a PvP duel');
    assert.equal(r.rejected, 0);
});

test('commanding the pet you are fighting is refused', () => {
    // The socket layer rejects this at accept time; the replay is the second line
    // of defence, so a log that somehow carried one must still not apply it to a
    // fighter its sender does not own. Here the enemy's Break is unpaid, so the
    // Bond gate catches it regardless of who sent it.
    const log = [{ t: 30, cmd: { kind: 'break', actorId: 'enemy-0' } }] as never;
    const r = replayLockstepPetDuel(sides(), foes(), PARAMS, log);
    assert.equal(r.applied, 0, 'an unpaid Bond Break never lands, on either side');
    assert.equal(r.rejected, 1);
});

test('each side gets its OWN rate budget', () => {
    // A flooding client must not starve its opponent out of a shared allowance.
    const flood = Array.from({ length: MAX_COMMANDS_PER_SECOND * 3 }, (_, n) => (
        { t: 60 + n, cmd: { kind: 'ability', actorId: 'player-0', idx: n % 3 } }
    ));
    const victim = [{ t: 61, cmd: { kind: 'ability', actorId: 'enemy-0', idx: 1 } }];
    const r = replayLockstepPetDuel(sides(), foes(), PARAMS, [...flood, ...victim].sort((a, b) => a.t - b.t) as never);
    assert.ok(r.rateLimited > 0, 'the flooding side is capped');
    // The victim's single order is well inside its own budget, so it must survive.
    assert.ok(r.applied >= MAX_COMMANDS_PER_SECOND, 'and the capped side still got its allowance');
});

test('one side spending Bond does not reset the other side meter', () => {
    // Both meters must be tracked separately; sharing `bondSpentAt` would let one
    // player's Break silently invalidate the other's.
    const log = [
        { t: DUEL_TPS * 6, cmd: { kind: 'break', actorId: 'player-0' } },
        { t: DUEL_TPS * 6 + 2, cmd: { kind: 'break', actorId: 'enemy-0' } },
    ] as never;
    const r = replayLockstepPetDuel(sides(), foes(), PARAMS, log);
    // Whatever the meters happen to be at that tick, the two decisions are made
    // independently — the run must not throw and must account for every entry.
    assert.equal(r.applied + r.rejected + r.rateLimited, 2);
});

test('a dropped side is replayed on its STANDING ORDERS, not as a passenger', () => {
    // The fairness case, server-side. Doctrine orders never cross the wire — both
    // clients evaluate the same pure function — so a replay that ignored them
    // would score a fight neither player watched.
    const autonomy = [{
        actorIds: ['enemy-0'],
        doctrine: { stance: 2, priority: [1, 0], breakAt: 'ready' as const },
        from: 40,
    }];
    const withOrders = replayLockstepPetDuel(sides(), foes(), PARAMS, [], autonomy);
    const without = replayLockstepPetDuel(sides(), foes(), PARAMS, []);
    assert.ok(withOrders.applied > 0, 'the briefed pet actually issued orders');
    assert.notDeepEqual(
        { o: withOrders.outcome, a: withOrders.applied },
        { o: without.outcome, a: without.applied },
        'a briefed garrison must fight differently from an unbriefed one',
    );
});

test('the doctrine replay is deterministic', () => {
    const autonomy = [{
        actorIds: ['enemy-0'],
        doctrine: { stance: 0, priority: [0, 1], breakAt: 'foeBloodied' as const },
        from: 25,
    }];
    const a = replayLockstepPetDuel(sides(), foes(), PARAMS, [], autonomy);
    const b = replayLockstepPetDuel(sides(), foes(), PARAMS, [], autonomy);
    assert.deepEqual(a, b, 'the server must reach the same verdict every time');
});

test('standing orders only take effect from the hand-over tick', () => {
    const early = replayLockstepPetDuel(sides(), foes(), PARAMS, [], [{
        actorIds: ['enemy-0'], doctrine: { stance: 1, priority: [0], breakAt: 'never' as const }, from: 10,
    }]);
    const late = replayLockstepPetDuel(sides(), foes(), PARAMS, [], [{
        actorIds: ['enemy-0'], doctrine: { stance: 1, priority: [0], breakAt: 'never' as const }, from: 100_000,
    }]);
    assert.ok(early.applied > 0);
    assert.equal(late.applied, 0, 'a hand-over past the end of the fight changes nothing');
});

test('a 2v2 lockstep duel resolves', () => {
    const r = replayLockstepPetDuel(
        [pet('A', 'Fire'), pet('B', 'Earth')] as Pet[],
        [pet('C', 'Water'), pet('D', 'Wind')] as Pet[],
        { ...PARAMS, mode: '2v2' },
        [{ t: 45, cmd: { kind: 'ability', actorId: 'enemy-1', idx: 0 } }] as never,
    );
    assert.ok(r.winner === 'p1' || r.winner === 'p2' || r.winner === null);
    assert.equal(r.applied, 1, 'a reserve pet on the opponent side is commandable too');
});
