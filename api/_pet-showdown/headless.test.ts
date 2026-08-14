/*
 * Headless Showdown resolution.
 *
 * These tests exist because two callers will settle real state on this
 * function's verdict — clan-war pet duels (which pay a war score) and, later,
 * stored replays. Both depend on the same property: a match resolved from
 * (pets, seed) is re-derivable, forever, on any machine. Everything below is
 * some form of that claim.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShowdownSession, type ShowdownSession } from './engine.js';
import { chooseShowdownAiCommands } from './ai.js';
import { resolveShowdownHeadless } from './headless.js';
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

function makeSession(seed = 4242, format: '1v1' | '2v2' = '1v1'): ShowdownSession {
    const n = format === '1v1' ? 1 : 2;
    return createShowdownSession({
        sessionId: 'headless-test',
        playerName: 'Tester',
        format,
        tier: 'warrior',
        seed,
        playerPets: Array.from({ length: n }, (_, i) => makePet(`p${i}`, { element: 'Water' })),
        enemyPets: Array.from({ length: n }, (_, i) => makePet(`e${i}`, { element: 'Fire' })),
        enemyTeamName: 'Test Foes',
        rewardEligible: false,
    });
}

test('a headless match reaches a verdict and reports the rounds it took', () => {
    const result = resolveShowdownHeadless(makeSession());
    assert.ok(result.outcome === 'win' || result.outcome === 'loss', 'the judge never returns a draw');
    assert.ok(result.rounds >= 1, 'at least one round was played');
    assert.ok(result.events.length > 0, 'the match produced an event log');
    assert.equal(result.events[0].t, 'roundStart', 'the log opens on a round boundary');
});

test('the same seed re-derives the same verdict, round count and event log', () => {
    const a = resolveShowdownHeadless(makeSession(777));
    const b = resolveShowdownHeadless(makeSession(777));
    assert.equal(a.outcome, b.outcome);
    assert.equal(a.rounds, b.rounds);
    // The full log, not just the verdict: clan-war settlement re-derives the
    // result, and a replay reader will play these events back frame for frame.
    assert.deepEqual(a.events, b.events);
});

test('a different seed can produce a different match', () => {
    // Not an assertion that every pair differs — with a fixed roster some seeds
    // legitimately land the same way. It asserts the seed is WIRED: across a
    // spread, at least one log diverges.
    const base = JSON.stringify(resolveShowdownHeadless(makeSession(1)).events);
    const diverged = [2, 3, 4, 5, 6, 7, 8].some(
        (seed) => JSON.stringify(resolveShowdownHeadless(makeSession(seed)).events) !== base,
    );
    assert.ok(diverged, 'the seed changes the match');
});

test('a finished session resolves to its recorded outcome with no new events', () => {
    const session = makeSession(31337);
    const first = resolveShowdownHeadless(session);
    // Re-running the SAME (now finished) session is what a settlement retry
    // does. It must not replay the fight or append to the log.
    const retry = resolveShowdownHeadless(session);
    assert.equal(retry.outcome, first.outcome);
    assert.equal(retry.rounds, 0);
    assert.deepEqual(retry.events, []);
});

test('2v2 resolves headlessly too', () => {
    const result = resolveShowdownHeadless(makeSession(99, '2v2'));
    assert.ok(result.outcome === 'win' || result.outcome === 'loss');
    assert.ok(result.rounds >= 1);
});

test('chooseShowdownAiCommands defaults to the enemy side', () => {
    // The live endpoint calls this with no side argument, so the default is
    // load-bearing: if it ever flipped, every AI fight would command the
    // player's own team.
    const session = makeSession(5150);
    const defaulted = chooseShowdownAiCommands(session);
    const explicit = chooseShowdownAiCommands(makeSession(5150), 'enemy');
    assert.deepEqual(defaulted, explicit);
    const enemyIds = new Set(session.enemy.map((p) => p.id));
    assert.ok(defaulted.length > 0, 'the AI issued orders');
    assert.ok(defaulted.every((c) => enemyIds.has(c.petId)), 'every order belongs to an enemy pet');
});

test('the player side can be commanded, and only commands player pets', () => {
    const session = makeSession(2468);
    const commands = chooseShowdownAiCommands(session, 'player');
    const playerIds = new Set(session.player.map((p) => p.id));
    assert.ok(commands.length > 0, 'the AI issued orders for the player team');
    assert.ok(commands.every((c) => playerIds.has(c.petId)), 'every order belongs to a player pet');
});

test('a mirror match is decided by the seed, not by which side the AI prefers', () => {
    // Identical teams on both sides. If the AI were biased toward the side it
    // was written for, one outcome would dominate across seeds. This catches a
    // side-swap bug that determinism alone would happily reproduce.
    const outcomes = Array.from({ length: 24 }, (_, i) => {
        const session = createShowdownSession({
            sessionId: `mirror-${i}`,
            playerName: 'Tester',
            format: '1v1',
            tier: 'warrior',
            seed: 1000 + i * 37,
            playerPets: [makePet('mirror-p')],
            enemyPets: [makePet('mirror-e')],
            enemyTeamName: 'Mirror',
            rewardEligible: false,
        });
        return resolveShowdownHeadless(session).outcome;
    });
    const wins = outcomes.filter((o) => o === 'win').length;
    assert.ok(wins > 0 && wins < outcomes.length, `a mirror match went ${wins}/24 to one side — the AI is side-biased`);
});
