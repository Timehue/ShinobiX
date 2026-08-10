/*
 * Pet Showdown engine tests — the server-only turn resolver.
 *
 * The engine is the sole authority on combat numbers (there is no client
 * mirror), so these tests are the whole safety net: determinism, KO flow,
 * the stamina/overexertion economy, the super meter, element counters, the
 * no-draw judge, and every jutsu kind resolving without a throw.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createShowdownSession,
    resolveShowdownRound,
    sealShowdownPet,
    showdownStateView,
    moveStaminaCost,
    type ShowdownSession,
} from './engine.js';
import { buildShowdownAiTeam, chooseShowdownAiCommands } from './ai.js';
import {
    SHOWDOWN_MAX_ROUNDS,
    SHOWDOWN_METER_MAX,
    type ShowdownCommand,
    type ShowdownEvent,
} from '../../shared/pet-showdown-contract.js';
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
            { name: 'Flame Bolt', power: 150, cooldown: 2, currentCooldown: 0, kind: 'damage' },
            { name: 'Cinder Finisher', power: 220, cooldown: 4, currentCooldown: 0, kind: 'damage', signature: true },
        ],
        ...overrides,
    } as Pet;
}

function makeSession(
    playerPets: Pet[],
    enemyPets: Pet[],
    seed = 12345,
    format: '1v1' | '2v2' | '3v3' = playerPets.length === 1 ? '1v1' : playerPets.length === 2 ? '2v2' : '3v3',
): ShowdownSession {
    return createShowdownSession({
        sessionId: 'testsession', playerName: 'Tester', format, tier: 'warrior', seed,
        playerPets, enemyPets, enemyTeamName: 'Test Foes',
    });
}

const attackAll = (session: ShowdownSession): ShowdownCommand[] =>
    session.player.filter((p) => !p.ko).map((p) => ({
        kind: 'move' as const, petId: p.id, moveIndex: 1, targetId: session.enemy.find((e) => !e.ko)?.id ?? '', timing: 0,
    }));

const enemyAttackAll = (session: ShowdownSession): ShowdownCommand[] =>
    session.enemy.filter((p) => !p.ko).map((p) => ({
        kind: 'move' as const, petId: p.id, moveIndex: 1, targetId: session.player.find((e) => !e.ko)?.id ?? '', timing: 0,
    }));

test('identical sessions with identical commands resolve identically', () => {
    const run = () => {
        const session = makeSession([makePet('a')], [makePet('b', { element: 'Water' })], 777);
        const log: ShowdownEvent[] = [];
        for (let i = 0; i < 6 && !session.finished; i++) {
            log.push(...resolveShowdownRound(session, attackAll(session), enemyAttackAll(session)));
        }
        return { log, view: showdownStateView(session) };
    };
    const first = run();
    const second = run();
    assert.deepEqual(first.log, second.log);
    assert.deepEqual(first.view, second.view);
});

test('a decisive stat gap produces a KO win and an end event', () => {
    const strong = makePet('strong', { attack: 400, hp: 2000, defense: 200 });
    const weak = makePet('weak', { attack: 40, hp: 300, defense: 20, rarity: 'standard' });
    const session = makeSession([strong], [weak]);
    let sawEnd = false;
    for (let i = 0; i < SHOWDOWN_MAX_ROUNDS && !session.finished; i++) {
        const events = resolveShowdownRound(session, attackAll(session), enemyAttackAll(session));
        sawEnd = sawEnd || events.some((e) => e.t === 'end' && e.outcome === 'win');
    }
    assert.equal(session.finished, true);
    assert.equal(session.outcome, 'win');
    assert.equal(sawEnd, true);
    assert.equal(session.enemy[0].ko, true);
});

test('overexertion fires the move but winds the pet for the next round', () => {
    const session = makeSession([makePet('a', { speed: 200 })], [makePet('b', { speed: 10, attack: 1 })]);
    session.player[0].stamina = 10; // every real move costs more than this
    const heavyIndex = session.player[0].moves.findIndex((m) => m.cost > 10);
    assert.ok(heavyIndex >= 0);
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: heavyIndex, targetId: 'b', timing: 0 },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.ok(action);
    assert.equal(action.overexerted, true);
    assert.equal(action.staminaAfter, 0);
    assert.ok((action.targets[0]?.damage ?? 0) > 0, 'the overexerted move still lands');

    const nextEvents = resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b', timing: 0 },
    ], [{ kind: 'rest', petId: 'b' }]);
    const skip = nextEvents.find((e) => e.t === 'skip' && e.actorId === 'a');
    assert.ok(skip, 'the wind costs the next-round action');
});

test('guarding halves incoming damage and reads back in the event', () => {
    const damageWith = (guarding: boolean): number => {
        const session = makeSession(
            [makePet('a', { speed: 200, element: 'None' })],
            [makePet('b', { speed: 10, element: 'None' })],
            4242,
        );
        if (guarding) session.enemy[0].guarding = true;
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b', timing: 0 },
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        assert.ok(action);
        assert.equal(action.targets[0].guarded, guarding);
        return action.targets[0].damage;
    };
    const open = damageWith(false);
    const guarded = damageWith(true);
    assert.ok(guarded < open * 0.6, `guarded ${guarded} should be about half of open ${open}`);
});

test('element advantage outdamages a neutral matchup and banners it', () => {
    const hit = (defenderElement: string) => {
        const session = makeSession(
            [makePet('a', { speed: 200, element: 'Fire' })],
            [makePet('b', { speed: 10, element: defenderElement as Pet['element'] })],
            999,
        );
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b', timing: 0 },
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        assert.ok(action);
        return action.targets[0];
    };
    const advantaged = hit('Wind');
    const neutral = hit('Fire');
    const weak = hit('Water');
    assert.equal(advantaged.effectiveness, 'super');
    assert.equal(neutral.effectiveness, 'neutral');
    assert.equal(weak.effectiveness, 'weak');
    assert.ok(advantaged.damage > neutral.damage);
    assert.ok(weak.damage < neutral.damage);
});

test('perfect timing outdamages an untapped needle', () => {
    const hit = (timing: number) => {
        const session = makeSession(
            [makePet('a', { speed: 200, element: 'None' })],
            [makePet('b', { speed: 10, element: 'None' })],
            31337,
        );
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b', timing },
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        return action!.targets[0].damage;
    };
    assert.ok(hit(2) > hit(0));
});

test('a super without a full meter downgrades to guard; with one it fires and resets', () => {
    const session = makeSession([makePet('a', { speed: 200 })], [makePet('b', { speed: 10, hp: 5000 })]);
    const denied = resolveShowdownRound(session, [
        { kind: 'super', petId: 'a', targetId: 'b', timing: 2 },
    ], [{ kind: 'rest', petId: 'b' }]);
    const deniedAction = denied.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.equal(deniedAction?.moveKind, 'guard');

    session.player[0].meter = SHOWDOWN_METER_MAX;
    session.player[0].readiness = 2;   // signatures HOLD until round 3 in battle
    const fired = resolveShowdownRound(session, [
        { kind: 'super', petId: 'a', targetId: 'b', timing: 2 },
    ], [{ kind: 'rest', petId: 'b' }]);
    const superAction = fired.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.ok(superAction);
    assert.equal(superAction.super, true);
    // The cast consumes the whole meter; the landed hit itself then starts the
    // rebuild, so "after" is the small on-hit gain — never a retained charge.
    assert.ok(superAction.meterAfter <= 10, `meter reset (got ${superAction.meterAfter})`);
    assert.ok(superAction.targets[0].damage > 0);
});

test('meter charges from both dealing and taking damage', () => {
    const session = makeSession([makePet('a', { speed: 200 })], [makePet('b', { speed: 10, hp: 5000 })]);
    resolveShowdownRound(session, attackAll(session), enemyAttackAll(session));
    assert.ok(session.player[0].meter > 0);
    assert.ok(session.enemy[0].meter > 0);
});

test('rest recovers stamina and a little hp', () => {
    const session = makeSession([makePet('a')], [makePet('b', { attack: 1 })]);
    session.player[0].stamina = 5;
    session.player[0].hp = 400;
    const events = resolveShowdownRound(session, [
        { kind: 'rest', petId: 'a' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.equal(action?.moveKind, 'rest');
    assert.ok((action?.targets[0].heal ?? 0) > 0);
    assert.ok(session.player[0].stamina > 5);
});

test('the round cap invokes the judge and never draws', () => {
    // Two unkillable walls — nobody dies before the cap.
    const wall = { hp: 20000, defense: 5000, attack: 5, rarity: 'mythic' as const };
    const session = makeSession([makePet('a', wall)], [makePet('b', { ...wall, hp: 19000 })]);
    let endEvent: Extract<ShowdownEvent, { t: 'end' }> | undefined;
    for (let i = 0; i < SHOWDOWN_MAX_ROUNDS + 2 && !session.finished; i++) {
        const events = resolveShowdownRound(session, attackAll(session), enemyAttackAll(session));
        endEvent = events.find((e): e is Extract<ShowdownEvent, { t: 'end' }> => e.t === 'end') ?? endEvent;
    }
    assert.equal(session.finished, true);
    assert.ok(endEvent);
    assert.equal(endEvent.byJudge, true);
    assert.ok(session.outcome === 'win' || session.outcome === 'loss');
});

test('an exact judge tie goes to the opponent — stalling is never free', () => {
    const wall = { hp: 20000, defense: 5000, attack: 5, rarity: 'mythic' as const };
    const session = makeSession([makePet('a', wall)], [makePet('b', wall)]);
    for (let i = 0; i < SHOWDOWN_MAX_ROUNDS + 2 && !session.finished; i++) {
        resolveShowdownRound(session, [{ kind: 'rest', petId: 'a' }], [{ kind: 'rest', petId: 'b' }]);
    }
    assert.equal(session.finished, true);
    assert.equal(session.outcome, 'loss');
});

test('every jutsu kind resolves without throwing', () => {
    const kinds = [
        'damage', 'buff', 'heal', 'debuff', 'dot', 'move', 'barrier', 'movelock', 'lifesteal',
        'shield', 'absorb', 'burn', 'freeze', 'confuse', 'stun', 'crush', 'wound', 'mark',
        'slow', 'haste', 'taunt', 'push', 'pull',
    ];
    for (const kind of kinds) {
        const caster = makePet('caster', {
            speed: 200,
            jutsus: [{ name: `${kind} test`, power: 140, cooldown: 0, currentCooldown: 0, kind: kind as never }],
        });
        const session = makeSession([caster], [makePet('dummy', { speed: 10, hp: 4000 })]);
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'caster', moveIndex: 1, targetId: 'dummy', timing: 1 },
        ], [{ kind: 'rest', petId: 'dummy' }]);
        const action = events.find((e) => e.t === 'action' && e.actorId === 'caster');
        assert.ok(action, `kind ${kind} produced an action event`);
    }
});

test('a stun landed after the target already acted survives upkeep and skips its NEXT round', () => {
    // The victim outspeeds the stunner, so it acts BEFORE the stun lands in
    // round 1 — the status must survive round 1's decay (bornRound exemption)
    // and cost the victim its round-2 action.
    const stunner = makePet('stunner', {
        speed: 10,
        jutsus: [{ name: 'Skull Ring', power: 120, cooldown: 0, currentCooldown: 0, kind: 'stun' }],
    });
    const session = makeSession([stunner], [makePet('victim', { speed: 200, hp: 6000, attack: 5 })]);
    resolveShowdownRound(session, [
        { kind: 'move', petId: 'stunner', moveIndex: 1, targetId: 'victim', timing: 0 },
    ], [{ kind: 'rest', petId: 'victim' }]);
    const events = resolveShowdownRound(session, [
        { kind: 'rest', petId: 'stunner' },
    ], [{ kind: 'rest', petId: 'victim' }]);
    const skip = events.find((e) => e.t === 'skip' && e.actorId === 'victim' && e.reason === 'stun');
    assert.ok(skip, 'the victim skips its round-2 action');
});

test('a stun landed before the target acts consumes its SAME-round action', () => {
    const stunner = makePet('stunner', {
        speed: 200,
        jutsus: [{ name: 'Skull Ring', power: 120, cooldown: 0, currentCooldown: 0, kind: 'stun' }],
    });
    const session = makeSession([stunner], [makePet('victim', { speed: 10, hp: 6000 })]);
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'stunner', moveIndex: 1, targetId: 'victim', timing: 0 },
    ], [{ kind: 'rest', petId: 'victim' }]);
    const skip = events.find((e) => e.t === 'skip' && e.actorId === 'victim' && e.reason === 'stun');
    assert.ok(skip, 'outspeeding the victim steals its pending action');
});

test('taunt in 2v2 drags single-target hits onto the taunter', () => {
    const taunter = makePet('taunter', {
        speed: 300, hp: 6000,
        jutsus: [{ name: 'War Bark', power: 80, cooldown: 0, currentCooldown: 0, kind: 'taunt' }],
    });
    const squishy = makePet('squishy', { speed: 5, hp: 6000 });
    const session = makeSession(
        [makePet('p1', { speed: 100 }), makePet('p2', { speed: 90 })],
        [taunter, squishy], 5555, '2v2',
    );
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'p1', moveIndex: 1, targetId: 'squishy', timing: 0 },
        { kind: 'move', petId: 'p2', moveIndex: 1, targetId: 'squishy', timing: 0 },
    ], [
        { kind: 'move', petId: 'taunter', moveIndex: 1, targetId: 'p1', timing: 0 },
        { kind: 'rest', petId: 'squishy' },
    ]);
    const playerHits = events.filter((e): e is Extract<ShowdownEvent, { t: 'action' }> =>
        e.t === 'action' && e.actorSide === 'player' && e.moveKind === 'damage');
    assert.ok(playerHits.length >= 1);
    for (const hit of playerHits) {
        assert.equal(hit.targets[0].id, 'taunter', 'the taunter absorbed the hit');
    }
});

test('burn ticks at end of round as a dot event', () => {
    const burner = makePet('burner', {
        speed: 200,
        jutsus: [{ name: 'Ember Coat', power: 160, cooldown: 0, currentCooldown: 0, kind: 'burn' }],
    });
    const session = makeSession([burner], [makePet('victim', { speed: 10, hp: 6000 })]);
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'burner', moveIndex: 1, targetId: 'victim', timing: 0 },
    ], [{ kind: 'rest', petId: 'victim' }]);
    const dot = events.find((e) => e.t === 'dot' && e.targetId === 'victim');
    assert.ok(dot, 'burn ticked in the same round upkeep');
});

test('sealShowdownPet clamps tampered stats and reserves the signature', () => {
    const forged = makePet('forged', {
        rarity: 'standard', hp: 999999, attack: 999999, defense: 999999, speed: 999999,
        jutsus: [
            { name: 'Nuke', power: 99999, cooldown: 0, currentCooldown: 0, kind: 'damage' },
            { name: 'Finisher', power: 300, cooldown: 4, currentCooldown: 0, kind: 'lifesteal', signature: true },
        ],
    });
    const sealed = sealShowdownPet(forged);
    assert.ok(sealed.maxHp <= 320 * 8);
    assert.ok(sealed.attack <= 40 * 8);
    assert.ok(sealed.moves.every((m) => m.power <= 320), 'jutsu power ceiling applied');
    assert.equal(sealed.signatureMove.name, 'Finisher');
    assert.ok(!sealed.moves.some((m) => m.name === 'Finisher'), 'signature is super-only');
    assert.equal(sealed.moves[0].name, 'Swift Strike', 'universal opener present');
});

test('moveStaminaCost bands are monotone', () => {
    assert.ok(moveStaminaCost(60) < moveStaminaCost(180));
    assert.ok(moveStaminaCost(180) < moveStaminaCost(300));
});

test('buildShowdownAiTeam returns a deterministic, scaled, distinct team', () => {
    const players = [makePet('mine', { level: 40 }), makePet('mine2', { level: 60 })];
    const teamA = buildShowdownAiTeam(players, 2, 'warrior', 424242);
    const teamB = buildShowdownAiTeam(players, 2, 'warrior', 424242);
    assert.deepEqual(teamA, teamB, 'same seed, same team');
    assert.equal(teamA.pets.length, 2);
    assert.equal(new Set(teamA.pets.map((p) => p.id)).size, 2);
    for (const pet of teamA.pets) assert.equal(pet.level, 50);
    assert.ok(teamA.teamName.length > 0);
    const champion = buildShowdownAiTeam(players, 2, 'champion', 424242);
    assert.ok(
        champion.pets.every((p) => p.rarity === 'legendary' || p.rarity === 'mythic'),
        'champion tier fields high-rarity species',
    );
});

test('AI commands are always legal for the enemy side', () => {
    const players = [makePet('mine', { level: 50 }), makePet('mine2', { level: 50 })];
    const { pets: enemyPets } = buildShowdownAiTeam(players, 2, 'champion', 777);
    const session = makeSession(players, enemyPets, 777, '2v2');
    for (let i = 0; i < 10 && !session.finished; i++) {
        const commands = chooseShowdownAiCommands(session);
        for (const c of commands) {
            assert.ok(session.enemy.some((p) => p.id === c.petId && !p.ko), 'AI commands its own living pets');
            if (c.kind === 'move') {
                const pet = session.enemy.find((p) => p.id === c.petId)!;
                assert.ok(c.moveIndex >= 0 && c.moveIndex < pet.moves.length);
                assert.equal(pet.moves[c.moveIndex].currentCooldown, 0, 'AI never picks a cooling move');
            }
            if (c.kind === 'super') {
                const pet = session.enemy.find((p) => p.id === c.petId)!;
                assert.equal(pet.meter, SHOWDOWN_METER_MAX, 'AI supers only at full meter');
            }
        }
        resolveShowdownRound(session, attackAll(session), commands);
    }
});

test('a signature in 2v2 splashes the second foe at a reduced rate', () => {
    const session = makeSession(
        [makePet('a', { speed: 300 }), makePet('a2', { speed: 5, attack: 1 })],
        [makePet('b', { speed: 4, hp: 6000, element: 'None' }), makePet('b2', { speed: 3, hp: 6000, element: 'None' })],
        777, '2v2',
    );
    session.player[0].meter = SHOWDOWN_METER_MAX;
    session.player[0].readiness = 2;   // signatures HOLD until round 3 in battle
    const events = resolveShowdownRound(session, [
        { kind: 'super', petId: 'a', targetId: 'b', timing: 0 },
        { kind: 'rest', petId: 'a2' },
    ], [{ kind: 'rest', petId: 'b' }, { kind: 'rest', petId: 'b2' }]);
    const superAction = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.super);
    assert.ok(superAction);
    const primary = superAction.targets.find((t) => t.id === 'b');
    const splash = superAction.targets.find((t) => t.id === 'b2');
    assert.ok(primary && primary.damage > 0);
    assert.ok(splash && splash.damage > 0, 'the second foe was splashed');
    assert.equal(splash.splash, true);
    assert.ok(splash.damage < primary.damage, 'splash is reduced-rate');
});

test('ally element synergy amplifies the hit and flags the event', () => {
    const damageWithAlly = (allyElement: string) => {
        const session = makeSession(
            [makePet('a', { speed: 300, element: 'None' }), makePet('ally', { speed: 5, attack: 1, element: allyElement as Pet['element'] })],
            [makePet('b', { speed: 4, hp: 6000, element: 'Wind' }), makePet('b2', { speed: 3, hp: 6000, element: 'Wind' })],
            424242, '2v2',
        );
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b', timing: 0 },
            { kind: 'rest', petId: 'ally' },
        ], [{ kind: 'rest', petId: 'b' }, { kind: 'rest', petId: 'b2' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        return action!.targets[0];
    };
    // Fire beats Wind → the Fire ally powers up the hit; a Water ally does not.
    const withSynergy = damageWithAlly('Fire');
    const without = damageWithAlly('Water');
    assert.equal(withSynergy.synergy, true);
    assert.equal(without.synergy, undefined);
    assert.ok(withSynergy.damage > without.damage);
});

test('the state view projects next-round order by effective speed', () => {
    const session = makeSession(
        [makePet('fast', { speed: 90 }), makePet('slow', { speed: 10 })],
        [makePet('mid', { speed: 50 }), makePet('dead', { speed: 99 })],
        1, '2v2',
    );
    session.enemy[1].ko = true;
    const view = showdownStateView(session);
    assert.deepEqual(view.nextOrder, ['fast', 'mid', 'slow'], 'speed-sorted, KO pets excluded');
});

function makeBenchSession(seed = 999): ShowdownSession {
    // 1v1 format with a bench: 'lead' fields, 'reserve' waits.
    const session = makeSession([makePet('lead', { speed: 50 })], [makePet('foe', { speed: 40, hp: 6000 })], seed, '1v1');
    const reserve = { ...session.player[0], id: 'reserve', name: 'reserve', benched: true, element: 'Water' as const };
    session.player.push(JSON.parse(JSON.stringify(reserve)));
    return session;
}

test('a switch swaps field and bench before any attack lands', () => {
    const session = makeBenchSession();
    const events = resolveShowdownRound(session, [
        { kind: 'switch', petId: 'lead', benchPetId: 'reserve' },
    ], [
        // The foe aims at the DEPARTING lead — the hit must land on the
        // incoming reserve instead (the prediction layer).
        { kind: 'move', petId: 'foe', moveIndex: 1, targetId: 'lead', timing: 0 },
    ]);
    const switchEvent = events.find((e): e is Extract<ShowdownEvent, { t: 'switch' }> => e.t === 'switch');
    assert.ok(switchEvent);
    assert.equal(switchEvent.outId, 'lead');
    assert.equal(switchEvent.inId, 'reserve');
    assert.equal(switchEvent.reinforcement, false);
    assert.equal(session.player.find((p) => p.id === 'lead')!.benched, true);
    assert.equal(session.player.find((p) => p.id === 'reserve')!.benched, false);
    // Neither switcher acted; the foe's attack retargeted the incoming pet.
    const leadActions = events.filter((e) => e.t === 'action' && e.actorId === 'lead');
    assert.equal(leadActions.length, 0, 'the switched-out pet forfeited its action');
    const foeHit = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'foe');
    assert.ok(foeHit);
    assert.equal(foeHit.targets[0].id, 'reserve', 'the attack landed on the incoming pet');
});

test('a KO with reserves triggers a reinforcement instead of a loss', () => {
    const session = makeBenchSession(1234);
    session.player[0].hp = 1;   // the lead dies to the first hit
    const events = resolveShowdownRound(session, [
        { kind: 'rest', petId: 'lead' },
    ], [
        { kind: 'move', petId: 'foe', moveIndex: 1, targetId: 'lead', timing: 2 },
    ]);
    assert.equal(session.finished, false, 'the bench keeps the battle alive');
    const reinforcement = events.find((e): e is Extract<ShowdownEvent, { t: 'switch' }> => e.t === 'switch' && e.reinforcement);
    assert.ok(reinforcement, 'the reserve walked in at round end');
    assert.equal(reinforcement.inId, 'reserve');
    assert.equal(session.player.find((p) => p.id === 'reserve')!.benched, false);
});

test('the whole team must fall before the side loses', () => {
    const session = makeBenchSession(777);
    session.player[0].hp = 1;
    session.player[1].hp = 1;
    let rounds = 0;
    while (!session.finished && rounds < 6) {
        rounds += 1;
        const fieldPet = session.player.find((p) => !p.ko && !p.benched);
        resolveShowdownRound(session, fieldPet ? [{ kind: 'rest', petId: fieldPet.id }] : [], [
            { kind: 'move', petId: 'foe', moveIndex: 1, targetId: fieldPet?.id ?? '', timing: 2 },
        ]);
    }
    assert.equal(session.finished, true);
    assert.equal(session.outcome, 'loss');
    assert.ok(rounds >= 2, 'took at least two rounds to fell both team members');
});

test('bench statuses are frozen — a burn cannot be waited out from the bench', () => {
    const burner = makePet('burner', {
        speed: 200,
        jutsus: [{ name: 'Ember Coat', power: 160, cooldown: 0, currentCooldown: 0, kind: 'burn' }],
    });
    const session = makeSession([burner], [makePet('victim', { speed: 10, hp: 6000 })], 55, '1v1');
    const reserve = JSON.parse(JSON.stringify({ ...session.enemy[0], id: 'reserve2', name: 'reserve2', benched: true }));
    session.enemy.push(reserve);
    // Round 1: burn the victim.
    resolveShowdownRound(session, [
        { kind: 'move', petId: 'burner', moveIndex: 1, targetId: 'victim', timing: 0 },
    ], [{ kind: 'rest', petId: 'victim' }]);
    const burnRounds = session.enemy[0].statuses.find((s) => s.kind === 'burn')?.rounds ?? 0;
    assert.ok(burnRounds > 0, 'victim is burning');
    // Round 2: victim switches out — benched, the burn must neither tick nor decay.
    const hpAtSwitch = session.enemy[0].hp;
    resolveShowdownRound(session, [
        { kind: 'rest', petId: 'burner' },
    ], [{ kind: 'switch', petId: 'victim', benchPetId: 'reserve2' }]);
    const victim = session.enemy.find((p) => p.id === 'victim')!;
    assert.equal(victim.benched, true);
    assert.equal(victim.hp, hpAtSwitch, 'no dot tick on the bench');
    assert.equal(victim.statuses.find((s) => s.kind === 'burn')?.rounds, burnRounds, 'no decay on the bench');
});

test('move priority reorders the round: a guard outruns a faster attacker', () => {
    // 'slowpoke' (speed 20) guards; 'speedy' (speed 90) attacks. Guard's 1.5x
    // priority beats 90 x 1.0 only if 20*1.5 > ... it does not — so use a
    // closer pair: guard at speed 70 (105 effective) vs attack at speed 90.
    const session = makeSession(
        [makePet('guardian', { speed: 70 })],
        [makePet('speedy', { speed: 90, hp: 6000 })],
        321,
    );
    const events = resolveShowdownRound(session, [
        { kind: 'guard', petId: 'guardian' },
    ], [
        { kind: 'move', petId: 'speedy', moveIndex: 1, targetId: 'guardian', timing: 0 },
    ]);
    const actions = events.filter((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action');
    assert.equal(actions[0].actorId, 'guardian', 'the guard resolved first despite lower speed');
    assert.equal(actions[1].targets[0].guarded, true, 'so the attack landed on a raised guard');
});

test('heavy moves HOLD: unusable on round one, live after the hold elapses', () => {
    const nuker = makePet('nuker', {
        speed: 200,
        jutsus: [{ name: 'Cataclysm', power: 300, cooldown: 3, currentCooldown: 0, kind: 'damage' }],
    });
    const session = makeSession([nuker], [makePet('wall', { speed: 10, hp: 9000, attack: 1 })]);
    const nukeIndex = session.player[0].moves.findIndex((m) => m.hold > 0);
    assert.ok(nukeIndex >= 0, 'the 300-power move carries a hold');
    const round1 = resolveShowdownRound(session, [
        { kind: 'move', petId: 'nuker', moveIndex: nukeIndex, targetId: 'wall', timing: 0 },
    ], [{ kind: 'rest', petId: 'wall' }]);
    const round1Action = round1.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'nuker');
    assert.equal(round1Action?.moveKind, 'guard', 'held move downgraded to guard on round 1');
    const round2 = resolveShowdownRound(session, [
        { kind: 'move', petId: 'nuker', moveIndex: nukeIndex, targetId: 'wall', timing: 0 },
    ], [{ kind: 'rest', petId: 'wall' }]);
    const round2Action = round2.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'nuker');
    assert.equal(round2Action?.moveName, 'Cataclysm', 'the haymaker fires once the hold elapses');
    assert.ok((round2Action?.targets[0]?.damage ?? 0) > 0);
});

test('kit overrides replace a broken catalog kit at seal time', () => {
    const oniHound = makePet('hound', {
        rarity: 'mythic',
        templateId: 'mythic-4',
        jutsus: [{ name: 'Weak Old Move', power: 95, cooldown: 3, currentCooldown: 0, kind: 'dot' }],
    });
    const sealed = sealShowdownPet(oniHound);
    assert.ok(!sealed.moves.some((m) => m.name === 'Weak Old Move'), 'old kit replaced');
    assert.ok(sealed.moves.some((m) => m.name === 'Abyssal Rend'), 'override kit applied');
    assert.equal(sealed.signatureMove.name, 'Oni Gate Requiem');
});

test('a full AI-vs-AI style fight completes inside the round cap with a winner', () => {
    for (const seed of [1, 7, 12345, 98765, 2024]) {
        const players = [makePet('mine', { level: 45 }), makePet('mine2', { level: 45, element: 'Water' })];
        const { pets: enemyPets } = buildShowdownAiTeam(players, 2, 'warrior', seed);
        const session = makeSession(players, enemyPets, seed, '2v2');
        for (let i = 0; i < SHOWDOWN_MAX_ROUNDS + 1 && !session.finished; i++) {
            resolveShowdownRound(session, attackAll(session), chooseShowdownAiCommands(session));
        }
        assert.equal(session.finished, true, `seed ${seed} finished`);
        assert.ok(session.outcome === 'win' || session.outcome === 'loss', `seed ${seed} has a winner`);
    }
});
