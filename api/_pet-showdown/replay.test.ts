/*
 * Showdown replay descriptors.
 *
 * A stored row carries inputs, not the fight, and the log is re-derived on
 * demand. Everything below defends one of the two properties that makes that
 * safe: re-derivation is stable, and an unrecognized row is REFUSED rather than
 * replayed under guesses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShowdownSession } from './engine.js';
import { resolveShowdownHeadless } from './headless.js';
import {
    showdownReplayDescriptor,
    isShowdownReplayDescriptor,
    replayShowdownDescriptor,
} from './replay.js';
import type { Pet } from '../_pet-sim/pet-types.js';

function makePet(id: string, overrides: Partial<Pet> = {}): Pet {
    return {
        id,
        name: id,
        rarity: 'standard',
        level: 30,
        xp: 0,
        maxLevel: 100,
        hp: 800,
        attack: 120,
        defense: 90,
        speed: 60,
        unlockedForPve: true,
        element: 'Fire',
        role: 'tracker',
        jutsus: [
            { name: 'Ember Jab', power: 90, cooldown: 1, currentCooldown: 0, kind: 'damage' },
            { name: 'Flame Bolt', power: 140, cooldown: 2, currentCooldown: 0, kind: 'damage' },
        ],
        ...overrides,
    } as Pet;
}

const inputs = {
    seed: 8675309,
    format: '1v1' as const,
    tier: 'warrior' as const,
    enemyTeamName: 'Test Foes',
    playerPets: [makePet('p0', { element: 'Water' })],
    enemyPets: [makePet('e0', { element: 'Fire' })],
};

test('a descriptor round-trips through JSON and still replays', () => {
    // The row lives in KV, so it survives serialization or it is useless.
    const descriptor = showdownReplayDescriptor(inputs);
    const stored = JSON.parse(JSON.stringify(descriptor));
    const a = replayShowdownDescriptor(descriptor);
    const b = replayShowdownDescriptor(stored);
    assert.equal(a.outcome, b.outcome);
    assert.deepEqual(a.events, b.events);
});

test('replaying the same descriptor twice gives the identical match', () => {
    const descriptor = showdownReplayDescriptor(inputs);
    const a = replayShowdownDescriptor(descriptor);
    const b = replayShowdownDescriptor(descriptor);
    assert.equal(a.outcome, b.outcome);
    assert.equal(a.rounds, b.rounds);
    assert.deepEqual(a.events, b.events);
});

test('a replay reproduces the match the live headless resolve produced', () => {
    // The property the Ladder depends on: what a viewer watches later is the
    // fight that actually decided the standings, not a fresh roll.
    const live = resolveShowdownHeadless(createShowdownSession({
        sessionId: 'live', playerName: 'Tester',
        format: inputs.format, tier: inputs.tier, seed: inputs.seed,
        playerPets: inputs.playerPets, enemyPets: inputs.enemyPets,
        enemyTeamName: inputs.enemyTeamName, rewardEligible: true,
    }));
    const replayed = replayShowdownDescriptor(showdownReplayDescriptor(inputs));
    assert.equal(replayed.outcome, live.outcome, 'the replay agrees with the recorded verdict');
    assert.equal(replayed.rounds, live.rounds);
    assert.deepEqual(replayed.events, live.events);
});

test('rewardEligible does not change the fight — only whether it can pay', () => {
    // Guards the replay's `rewardEligible: false`: if that flag reached the
    // engine's numbers, every replay would diverge from the match it depicts.
    const make = (rewardEligible: boolean) => resolveShowdownHeadless(createShowdownSession({
        sessionId: 'flag', playerName: 'Tester',
        format: inputs.format, tier: inputs.tier, seed: inputs.seed,
        playerPets: inputs.playerPets, enemyPets: inputs.enemyPets,
        enemyTeamName: inputs.enemyTeamName, rewardEligible,
    }));
    assert.deepEqual(make(true).events, make(false).events);
});

test('2v2 descriptors replay', () => {
    const descriptor = showdownReplayDescriptor({
        ...inputs,
        format: '2v2',
        playerPets: [makePet('p0', { element: 'Water' }), makePet('p1', { element: 'Wind' })],
        enemyPets: [makePet('e0'), makePet('e1', { element: 'Earth' })],
    });
    const result = replayShowdownDescriptor(descriptor);
    assert.ok(result.outcome === 'win' || result.outcome === 'loss');
    assert.ok(result.events.length > 0);
});

test('an unrecognized descriptor is refused, not guessed at', () => {
    const descriptor = showdownReplayDescriptor(inputs);
    // A legacy coliseum row must never be replayed by this reader — that is the
    // whole point of the two readers sitting side by side.
    assert.throws(() => replayShowdownDescriptor({ kind: 'coliseum', seed: 1, player: {}, enemy: {} }));
    // A future version this build does not understand.
    assert.throws(() => replayShowdownDescriptor({ ...descriptor, version: 99 }));
    assert.throws(() => replayShowdownDescriptor(null));
    assert.throws(() => replayShowdownDescriptor({ kind: 'showdown', version: 1 }));
});

test('the type guard accepts only what the replayer can actually handle', () => {
    assert.ok(isShowdownReplayDescriptor(showdownReplayDescriptor(inputs)));
    assert.ok(!isShowdownReplayDescriptor({ kind: 'coliseum', seed: 1 }));
    assert.ok(!isShowdownReplayDescriptor(undefined));
});
