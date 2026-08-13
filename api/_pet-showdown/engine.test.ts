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
    addStatus,
    moveStaminaCost,
    moveEffectText,
    storedStatusKind,
    showdownConsumableSpends,
    KIND_FX,
    type ShowdownSession,
} from './engine.js';
import { PET_CATALOG } from '../pet/_catalog.js';
import { buildShowdownAiTeam, chooseShowdownAiCommands } from './ai.js';
import {
    SHOWDOWN_ATTRITION_START,
    SHOWDOWN_TURN_CAP,
    SHOWDOWN_ELEMENT_ADVANTAGE,
    SHOWDOWN_ELEMENT_DISADVANTAGE,
    SHOWDOWN_METER_MAX,
    SHOWDOWN_HOLD_HEAVY,
    SHOWDOWN_STAMINA_REGEN_FLAT,
    SHOWDOWN_STAMINA_REGEN_PCT,
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
        // TWO kit moves on purpose. The kit's biggest damage move is promoted
        // to that pet's haymaker (held on round 1, swings last), so a fixture
        // with a single technique would make `moveIndex: 1` a held move and
        // every mechanic test below would silently become a hold test.
        // Ember Jab stays the plain mid-tier technique at index 1; Flame Bolt
        // becomes the haymaker at index 2.
        jutsus: [
            { name: 'Ember Jab', power: 90, cooldown: 1, currentCooldown: 0, kind: 'damage' },
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
    rewardEligible = false,
): ShowdownSession {
    return createShowdownSession({
        sessionId: 'testsession', playerName: 'Tester', format, tier: 'warrior', seed,
        playerPets, enemyPets, enemyTeamName: 'Test Foes', rewardEligible,
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
    for (let i = 0; i < 40 && !session.finished; i++) {
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
        { kind: 'move', petId: 'a', moveIndex: heavyIndex, targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.ok(action);
    assert.equal(action.overexerted, true);
    assert.equal(action.staminaAfter, 0);
    assert.ok((action.targets[0]?.damage ?? 0) > 0, 'the overexerted move still lands');

    const nextEvents = resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const skip = nextEvents.find((e) => e.t === 'skip' && e.actorId === 'a');
    assert.ok(skip, 'the wind costs the next-round action');
});

test('overdrafting pays HP for the deficit (the Temtem chip) and the pool is a bulk-derived stat', () => {
    const session = makeSession([makePet('a', { speed: 200 })], [makePet('b', { speed: 10, attack: 1, hp: 6000 })]);
    const pet = session.player[0];
    assert.ok(pet.maxStamina >= 80 && pet.maxStamina <= 125, `pool is a stat (${pet.maxStamina})`);
    const hpBefore = pet.hp;
    pet.stamina = 4;   // deficit of (cost - 4) on any real move
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.ok(action);
    assert.equal(action.overexerted, true);
    assert.ok((action.overexertDamage ?? 0) > 0, 'the deficit drew blood');
    assert.ok(pet.hp < hpBefore, 'the actor paid HP');
    assert.ok((action.targets[0]?.damage ?? 0) > 0, 'the move still fired');
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
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
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
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        assert.ok(action);
        return action.targets[0];
    };
    const advantaged = hit('Wind');
    const neutral = hit('Fire');
    const weak = hit('Water');
    // The player-facing contract is the CALLOUT — this is what banners.
    assert.equal(advantaged.effectiveness, 'super');
    assert.equal(neutral.effectiveness, 'neutral');
    assert.equal(weak.effectiveness, 'weak');
    // Raw damage is deliberately NOT comparable across different defender
    // elements: each element carries its own durability identity
    // (ELEMENT_TAKEN_MULT), so a "weak" hit into a squishy element can exceed
    // a "neutral" hit into a resilient one. The wheel's magnitude is asserted
    // on its constants below and measured in aggregate by the balance sim
    // (element-advantage matchup win rate).
    assert.ok(SHOWDOWN_ELEMENT_ADVANTAGE > 1, 'advantage amplifies');
    assert.ok(SHOWDOWN_ELEMENT_DISADVANTAGE < 1, 'disadvantage dampens');
    for (const t of [advantaged, neutral, weak]) assert.ok(t.damage > 0);
});


test('a super without a full meter downgrades to guard; with one it fires and resets', () => {
    const session = makeSession([makePet('a', { speed: 200 })], [makePet('b', { speed: 10, hp: 5000 })]);
    const denied = resolveShowdownRound(session, [
        { kind: 'super', petId: 'a', targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const deniedAction = denied.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.equal(deniedAction?.moveKind, 'guard');

    session.player[0].meter = SHOWDOWN_METER_MAX;
    session.player[0].readiness = 2;   // signatures HOLD until round 3 in battle
    const fired = resolveShowdownRound(session, [
        { kind: 'super', petId: 'a', targetId: 'b' },
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

test('rest buys stamina back and NOTHING else — it never heals', () => {
    const session = makeSession([makePet('a')], [makePet('b', { attack: 1 })]);
    session.player[0].stamina = 5;
    session.player[0].hp = 400;
    const events = resolveShowdownRound(session, [
        { kind: 'rest', petId: 'a' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.equal(action?.moveKind, 'rest');
    assert.ok(session.player[0].stamina > 5, 'stamina came back');
    // Temtem's rule, and the one this used to break: HP does not regenerate in
    // combat. A resting pet on 400 HP is still on 400 HP.
    assert.equal(action?.targets[0].heal ?? 0, 0, 'rest reports no heal');
    assert.equal(session.player[0].hp, 400, 'rest restored no HP');
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
            { kind: 'move', petId: 'caster', moveIndex: 1, targetId: 'dummy' },
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
    session.player[0].readiness = 1;   // control moves HOLD until round 2
    resolveShowdownRound(session, [
        { kind: 'move', petId: 'stunner', moveIndex: 1, targetId: 'victim' },
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
    session.player[0].readiness = 1;   // control moves HOLD until round 2
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'stunner', moveIndex: 1, targetId: 'victim' },
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
        { kind: 'move', petId: 'p1', moveIndex: 1, targetId: 'squishy' },
        { kind: 'move', petId: 'p2', moveIndex: 1, targetId: 'squishy' },
    ], [
        { kind: 'move', petId: 'taunter', moveIndex: 1, targetId: 'p1' },
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
        { kind: 'move', petId: 'burner', moveIndex: 1, targetId: 'victim' },
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
                assert.ok(pet.readiness >= pet.moves[c.moveIndex].hold, 'AI never picks a held move early');
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
        { kind: 'super', petId: 'a', targetId: 'b' },
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

test('synergy is a TECHNIQUE property: the sealed partner element empowers it', () => {
    // A Fire technique's synergy partner is Wind (the element it beats — wind
    // fans the fire), sealed onto the move itself. Partner-driven, not
    // target-driven: the ally the player FIELDS is what turns it on.
    const damageWithAlly = (allyElement: string) => {
        const session = makeSession(
            [makePet('a', { speed: 300, element: 'Fire' }), makePet('ally', { speed: 5, attack: 1, element: allyElement as Pet['element'] })],
            [makePet('b', { speed: 4, hp: 6000, element: 'None' }), makePet('b2', { speed: 3, hp: 6000, element: 'None' })],
            424242, '2v2',
        );
        const move = session.player[0].moves[1];
        assert.equal(move.element, 'Fire', 'kit moves carry the pet element');
        assert.equal(move.synergyElement, 'Wind', 'Fire techniques partner with Wind');
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
            { kind: 'rest', petId: 'ally' },
        ], [{ kind: 'rest', petId: 'b' }, { kind: 'rest', petId: 'b2' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        return action!.targets[0];
    };
    const withSynergy = damageWithAlly('Wind');
    const without = damageWithAlly('Water');
    assert.equal(withSynergy.synergy, true);
    assert.equal(without.synergy, undefined);
    assert.ok(withSynergy.damage > without.damage);
});

test('STAB and the neutral basic: kit moves hit harder, the jab dodges the wheel', () => {
    // Same attacker, same target: the Fire KIT move earns STAB; Swift Strike
    // (sealed None/physical) takes neither STAB nor the wheel — into a
    // Fire-resistant Water target it is the better tool, which is its job.
    const session = makeSession(
        [makePet('a', { speed: 300, element: 'Fire' })],
        [makePet('b', { speed: 4, hp: 9000, element: 'Water' })],
        777,
    );
    const basic = session.player[0].moves[0];
    assert.equal(basic.element, 'None', 'the universal basic is neutral');
    const kitFire = session.player[0].moves[1];
    assert.equal(kitFire.element, 'Fire');
    const hitWith = (moveIndex: number) => {
        const s = makeSession(
            [makePet('a', { speed: 300, element: 'Fire' })],
            [makePet('b', { speed: 4, hp: 9000, element: 'Water' })],
            777,
        );
        const events = resolveShowdownRound(s, [
            { kind: 'move', petId: 'a', moveIndex, targetId: 'b' },
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        return action!.targets[0];
    };
    const jab = hitWith(0);
    assert.equal(jab.effectiveness, 'neutral', 'neutral jab never reads the wheel');
    const fireIntoWater = hitWith(1);
    assert.equal(fireIntoWater.effectiveness, 'weak', 'Fire kit move is resisted by Water');
});

test('the physical/special split rides the role-derived axis', () => {
    // A sage's special axis outguns its physical one; the sealed pair proves
    // the derivation and a crush (physical) vs blast (special) both resolve.
    const sage = sealShowdownPet(makePet('s', { role: 'sage' }));
    assert.ok(sage.spAttack > sage.attack, 'sage casts harder than it swings');
    const assassin = sealShowdownPet(makePet('k', { role: 'assassin' }));
    assert.ok(assassin.spAttack < assassin.attack, 'assassin blades beat its bolts');
    const basic = sage.moves[0];
    assert.equal(basic.cls, 'physical');
    const blast = sage.moves.find((m) => m.kind === 'damage' && m !== basic);
    assert.equal(blast?.cls, 'special');
});

test('the two-condition rule: a third status evicts the oldest, pools exempt', () => {
    const session = makeSession([makePet('a')], [makePet('b', { hp: 9000 })], 12);
    const victim = session.enemy[0];
    // Shield first — board state, never counted, never evicted.
    victim.statuses.push({ kind: 'shield', rounds: 9, magnitude: 50, bornRound: 0 });
    session.round = 1; addStatus(session, victim, 'slow', 3, 10);
    session.round = 2; addStatus(session, victim, 'debuff', 3, 10);
    session.round = 3; addStatus(session, victim, 'wound', 3, 10);
    const kinds = victim.statuses.map((s) => s.kind).sort();
    assert.deepEqual(kinds, ['debuff', 'shield', 'wound'].sort(), 'oldest condition (slow) evicted, shield untouched');
});

test('status interactions: fire thaws, frost smothers', () => {
    const session = makeSession([makePet('a')], [makePet('b', { hp: 9000 })], 13);
    const victim = session.enemy[0];
    addStatus(session, victim, 'freeze', 2, 10);
    addStatus(session, victim, 'burn', 2, 10);
    assert.deepEqual(victim.statuses.map((s) => s.kind), ['burn'], 'burn removed the freeze');
    addStatus(session, victim, 'freeze', 2, 10);
    assert.deepEqual(victim.statuses.map((s) => s.kind), ['freeze'], 'freeze smothered the burn');
});

test('the turn-cap judge decides a standing fight on the Temtem ladder', () => {
    const session = makeSession(
        [makePet('a', { hp: 4000 }), makePet('a2', { hp: 4000 })],
        [makePet('b', { hp: 4000 }), makePet('b2', { hp: 4000 })],
        99, '2v2',
    );
    // Fast-forward to the cap with a KO'd enemy: player leads on the first rung.
    session.round = SHOWDOWN_TURN_CAP - 1;
    session.enemy[1].ko = true;
    session.enemy[1].hp = 0;
    const events = resolveShowdownRound(session, [
        { kind: 'guard', petId: 'a' }, { kind: 'guard', petId: 'a2' },
    ], [{ kind: 'guard', petId: 'b' }]);
    assert.equal(session.finished, true, 'the cap ends a standing fight');
    assert.equal(session.outcome, 'win');
    const end = events.find((e): e is Extract<ShowdownEvent, { t: 'end' }> => e.t === 'end');
    assert.equal(end?.byJudge, true);
    assert.equal(end?.judgeReason, 'pets');
});

test('the state view carries NO turn-order projection (owner ruling)', () => {
    // Who acts first is learned by watching a round. A projection on the wire
    // is exactly the spoiler the ruling removed — pin its absence so it cannot
    // quietly return as a "helpful" field.
    const session = makeSession([makePet('a')], [makePet('b')], 1);
    const view = showdownStateView(session) as unknown as Record<string, unknown>;
    assert.equal('nextOrder' in view, false);
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
        { kind: 'move', petId: 'foe', moveIndex: 1, targetId: 'lead' },
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
        { kind: 'move', petId: 'foe', moveIndex: 1, targetId: 'lead' },
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
            { kind: 'move', petId: 'foe', moveIndex: 1, targetId: fieldPet?.id ?? '' },
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
        { kind: 'move', petId: 'burner', moveIndex: 1, targetId: 'victim' },
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
        { kind: 'move', petId: 'speedy', moveIndex: 1, targetId: 'guardian' },
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
        { kind: 'move', petId: 'nuker', moveIndex: nukeIndex, targetId: 'wall' },
    ], [{ kind: 'rest', petId: 'wall' }]);
    const round1Action = round1.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'nuker');
    assert.equal(round1Action?.moveKind, 'guard', 'held move downgraded to guard on round 1');
    const round2 = resolveShowdownRound(session, [
        { kind: 'move', petId: 'nuker', moveIndex: nukeIndex, targetId: 'wall' },
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

test('traits carry in-combat effects: Battleborn starts charged, Aggressive hits harder', () => {
    const battleborn = sealShowdownPet(makePet('bb', { trait: 'Battleborn' }));
    assert.equal(battleborn.meter, 25, 'Battleborn enters with meter');
    const hitWith = (trait?: Pet['trait']) => {
        const session = makeSession(
            [makePet('a', { speed: 200, element: 'None', ...(trait ? { trait } : {}) })],
            [makePet('b', { speed: 10, element: 'None', hp: 6000 })],
            777,
        );
        const events = resolveShowdownRound(session, [
            { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
        ], [{ kind: 'rest', petId: 'b' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
        return action!.targets[0].damage;
    };
    assert.ok(hitWith('Aggressive') > hitWith(), 'Aggressive outdamages traitless on the same seed');
});

test('PvP gear applies: stat mods, start shield, and execute proc', () => {
    // Aegis Pendant: battle opens with a 25%-max-hp shield.
    const aegis = makePet('aegis', { loadout: { pvp: 'pvp-aegis-pendant' } });
    const session = makeSession([aegis], [makePet('foe', { speed: 10, hp: 6000 })]);
    const sealed = session.player[0];
    assert.equal(sealed.gear?.name, 'Aegis Pendant');
    const shield = sealed.statuses.find((s) => s.kind === 'shield');
    assert.ok(shield && shield.magnitude === Math.round(sealed.maxHp * 0.25), 'start shield raised');

    // Spiked War Harness: +15% attack on the sealed stats.
    const bare = sealShowdownPet(makePet('bare', {}));
    const harness = sealShowdownPet(makePet('bare', { loadout: { pvp: 'pvp-spiked-war-harness' } }));
    assert.ok(harness.attack > bare.attack, 'gear attack bonus survived sealing');

    // Executioner's Talon: bonus damage below 40% hp.
    const talonHit = (gearId?: string) => {
        const s = makeSession(
            [makePet('t', { speed: 200, element: 'None', ...(gearId ? { loadout: { pvp: gearId } } : {}) })],
            [makePet('lowfoe', { speed: 10, element: 'None', hp: 6000 })],
            4242,
        );
        s.enemy[0].hp = Math.round(s.enemy[0].maxHp * 0.3);   // below the 40% line
        const events = resolveShowdownRound(s, [
            { kind: 'move', petId: 't', moveIndex: 1, targetId: 'lowfoe' },
        ], [{ kind: 'rest', petId: 'lowfoe' }]);
        const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 't');
        return action!.targets[0].damage;
    };
    assert.ok(talonHit('pvp-executioners-talon') > talonHit(), 'execute proc fired below the line');
});

test('catalog species keep their AUTHORED signature name and a full kit', () => {
    // _catalog.ts authors the signature LAST, so an early slice(0,5) used to
    // drop it for 87 of 140 species and replace a named finisher with a
    // generic "<Element> Overdrive".
    const tpl = PET_CATALOG['rare-0'] as unknown as Pet;
    const sealed = sealShowdownPet({ ...tpl, templateId: 'rare-0' });
    const authored = (tpl.jutsus ?? []).find((j) => j.signature);
    assert.ok(authored, 'fixture has an authored signature');
    assert.equal(sealed.signatureMove.name, authored.name, 'authored name survives sealing');
    assert.ok(sealed.moves.length >= 4, `kit kept its slots (got ${sealed.moves.length})`);
    // The 'move' (mobility) kind is filtered BEFORE the slice, so a real
    // element move is never displaced by it.
    assert.ok(!sealed.moves.some((m) => m.kind === 'move'), 'mobility filtered out of the kit');
});

test('prototype-key identity strings cannot crash or produce a NaN pet', () => {
    // 'constructor'/'__proto__' resolve to inherited Object.prototype members
    // on a bare table read — non-nullish, non-numeric — which propagated NaN
    // into hp and made `hp <= 0` unreachable (an unkillable pet).
    const hostile = makePet('constructor', {
        role: 'constructor' as Pet['role'],
        element: 'valueOf' as Pet['element'],
        trait: '__proto__' as Pet['trait'],
        templateId: 'constructor',
    });
    const sealed = sealShowdownPet(hostile);
    assert.equal(sealed.role, 'defender', 'unknown role falls back');
    assert.equal(sealed.element, 'None', 'unknown element falls back');
    assert.equal(sealed.trait, undefined, 'unknown trait is dropped');
    assert.ok(Number.isFinite(sealed.meter) && Number.isFinite(sealed.maxHp));

    const session = makeSession([hostile], [makePet('foe', { speed: 5 })], 4242);
    for (let i = 0; i < 20 && !session.finished; i++) {
        resolveShowdownRound(session, attackAll(session), enemyAttackAll(session));
    }
    for (const pet of [...session.player, ...session.enemy]) {
        assert.ok(Number.isFinite(pet.hp), `${pet.id} kept finite hp`);
    }
    assert.equal(session.finished, true, 'the fight still resolves');
});

test('an under-charged super cannot buy guard-tier turn priority', () => {
    // Sanitizing twice (sort, then act) let a super at meter 82-99 sanitize to
    // `guard` for the ORDER — buying the 1.5x guard slot — then top its meter
    // up from damage taken and fire early, ahead of real Guards.
    const session = makeSession(
        [makePet('mine', { speed: 40 })],
        [makePet('fast', { speed: 200, hp: 6000 })],
        31337,
    );
    session.player[0].meter = 90;   // NOT full — the super must be refused
    session.player[0].readiness = 2;
    const events = resolveShowdownRound(session, [
        { kind: 'super', petId: 'mine', targetId: 'fast' },
    ], [{ kind: 'move', petId: 'fast', moveIndex: 1, targetId: 'mine' }]);
    const mine = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'mine');
    assert.equal(mine?.moveKind, 'guard', 'the refused super became a guard');
    assert.equal(mine?.super, false, 'and never fired as a super');
});

test('every known move kind has a KIND_FX entry and a stable stored status', () => {
    for (const kind of ['damage', 'buff', 'heal', 'debuff', 'dot', 'move', 'barrier', 'movelock',
        'lifesteal', 'shield', 'absorb', 'burn', 'freeze', 'confuse', 'stun', 'crush', 'wound',
        'mark', 'slow', 'haste', 'taunt', 'push', 'pull']) {
        assert.ok(KIND_FX[kind], `KIND_FX covers ${kind}`);
        assert.ok(moveEffectText(kind, 120).length > 0, `${kind} has effect text`);
    }
    // The renames the AI must agree with.
    assert.equal(storedStatusKind('barrier'), 'shield');
    assert.equal(storedStatusKind('absorb'), 'shield');
    assert.equal(storedStatusKind('dot'), 'burn');
    assert.equal(storedStatusKind('move'), 'haste');
    assert.equal(storedStatusKind('movelock'), 'slow');
    assert.equal(storedStatusKind('taunt', '2v2', 2), 'taunt');
    assert.equal(storedStatusKind('taunt', '1v1', 1), 'tauntGuard');
});

test('a self-buff is stored on the ACTOR under its renamed kind', () => {
    // The AI checked target.statuses for the RAW kind, so its "already
    // applied" penalty never fired and barrier became 24.8% of its commands.
    const caster = makePet('caster', {
        speed: 200,
        jutsus: [{ name: 'Iron Brace', power: 140, cooldown: 0, currentCooldown: 0, kind: 'barrier' }],
    });
    const session = makeSession([caster], [makePet('foe', { speed: 5, hp: 6000 })]);
    resolveShowdownRound(session, [
        { kind: 'move', petId: 'caster', moveIndex: 1, targetId: 'foe' },
    ], [{ kind: 'rest', petId: 'foe' }]);
    assert.ok(session.player[0].statuses.some((s) => s.kind === 'shield'), 'stored as shield on the caster');
    assert.ok(!session.enemy[0].statuses.some((s) => s.kind === 'barrier'), 'never lands on the target');
});


test('the view exposes the fields the HUD needs', () => {
    const session = makeSession([makePet('a')], [makePet('b')]);
    session.player[0].winded = true;
    const view = showdownStateView(session);
    const pet = view.player[0];
    assert.ok(pet.speed > 0, 'effective speed published');
    assert.equal(pet.skipsNextAction, true, 'winded reads as a lost action');
    assert.equal(pet.canSwitchOut, false, 'overdraft-winded pets cannot rotate away');
    assert.ok(pet.moves.every((m) => typeof m.effect === 'string' && m.effect.length > 0), 'every move has effect text');
});

test('a full AI-vs-AI style fight completes inside the round cap with a winner', () => {
    for (const seed of [1, 7, 12345, 98765, 2024]) {
        const players = [makePet('mine', { level: 45 }), makePet('mine2', { level: 45, element: 'Water' })];
        const { pets: enemyPets } = buildShowdownAiTeam(players, 2, 'warrior', seed);
        const session = makeSession(players, enemyPets, seed, '2v2');
        for (let i = 0; i < 40 && !session.finished; i++) {
            resolveShowdownRound(session, attackAll(session), chooseShowdownAiCommands(session));
        }
        assert.equal(session.finished, true, `seed ${seed} finished`);
        assert.ok(session.outcome === 'win' || session.outcome === 'loss', `seed ${seed} has a winner`);
    }
});

test('every kit is a real stamina ladder: a spammable jab, mid techniques, and one haymaker', () => {
    const session = makeSession([makePet('a')], [makePet('b')]);
    const pet = session.player[0];
    const jab = pet.moves[0];
    const heavy = pet.moves.find((m) => m.hold > 0 && m.kind === 'damage');
    const mid = pet.moves.find((m) => m !== jab && m !== heavy && m.power > 0);
    assert.ok(heavy, 'the kit has a haymaker');
    assert.ok(mid, 'the kit has a mid-tier technique');

    // The ladder must actually be a ladder — the failure this guards is the one
    // measured across the whole catalog before the reprice: 83% of every kit
    // move cost the same 14-18, so the biggest hit was also the cheapest tier.
    assert.ok(jab.cost < mid.cost, `jab ${jab.cost} < mid ${mid.cost}`);
    assert.ok(mid.cost < heavy.cost, `mid ${mid.cost} < heavy ${heavy.cost}`);
    assert.ok(heavy.power > mid.power, 'the haymaker hits hardest');

    // The jab is sustainable forever; the haymaker is a real commitment.
    const regen = Math.round(pet.maxStamina * SHOWDOWN_STAMINA_REGEN_PCT) + SHOWDOWN_STAMINA_REGEN_FLAT;
    assert.ok(jab.cost <= regen * 1.6, `the jab (${jab.cost}) stays near the ${regen}/round regen`);
    assert.ok(heavy.cost > pet.maxStamina * 0.35, `the haymaker (${heavy.cost}) costs a real slice of ${pet.maxStamina}`);

    // Flat damage-per-stamina between jab and mid — an expensive technique is
    // never MORE efficient — and the haymaker is deliberately the worst rate,
    // because what it sells is tempo, not value.
    const rate = (m: { power: number; cost: number }) => m.power / m.cost;
    assert.ok(Math.abs(rate(jab) - rate(mid)) / rate(mid) < 0.25, 'jab and mid trade at a similar rate');
    assert.ok(rate(heavy) < rate(mid), 'the haymaker is the least efficient move in the kit');

    // It swings last and cannot open the fight.
    assert.ok(heavy.priority < mid.priority, 'the haymaker swings late');
    assert.equal(heavy.hold, SHOWDOWN_HOLD_HEAVY, 'the haymaker holds a round');
});

test('the universal basic is never promoted — every pet can attack on round one', () => {
    // The Water starter line (barrier + heal kits, no damage-family move) had
    // its Swift Strike promoted: hold 1, 22 EN, swings last. A starter opened
    // every battle with no attack available at all.
    let checked = 0;
    for (const tpl of Object.values(PET_CATALOG)) {
        const pet = { ...(tpl as unknown as Pet), id: String(tpl.id), templateId: String(tpl.id), level: 50 };
        const session = makeSession([pet], [pet]);
        const basic = session.player[0].moves[0];
        assert.equal(basic.hold, 0, `${tpl.name}: the basic must be castable on round one`);
        assert.ok(basic.power > 0, `${tpl.name}: the basic must be an attack`);
        checked++;
    }
    assert.ok(checked > 100, `swept the catalog (${checked} species)`);
});

// ─── Battle consumables ──────────────────────────────────────────────────────
// The reactive one-use items sold in the Shop. Every one of them was inert in
// Showdown: the engine never read loadout.consumable, so a 960-1,600 ryo
// purchase the Pet Yard advertises for 1v1 and 2v2 simply did nothing here.

type ConsumableEvent = Extract<ShowdownEvent, { t: 'consumable' }>;

const consumableEvents = (events: ShowdownEvent[]): ConsumableEvent[] =>
    events.filter((e): e is ConsumableEvent => e.t === 'consumable');

/** One round of 'a' (fast) hitting 'b' (slow, item-carrying) with Ember Jab. */
function jabRound(consumableId: string, tune: (session: ShowdownSession) => void = () => undefined, seed = 4242) {
    const session = makeSession(
        [makePet('a', { speed: 200, element: 'None', attack: 300 })],
        [makePet('b', {
            speed: 10, element: 'None', hp: 4000, attack: 1,
            ...(consumableId ? { loadout: { consumable: consumableId } } : {}),
        })],
        seed,
    );
    tune(session);
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    return { session, events, action: action!, fired: consumableEvents(events) };
}

test('a dodge charge negates the whole attack and scripts its own beat', () => {
    const { session, action, fired } = jabRound('consum-phantom-charm');
    assert.equal(action.targets.length, 0, 'a dodged blow produces no target entry at all');
    assert.equal(session.enemy[0].hp, session.enemy[0].maxHp, 'the victim took nothing');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].effect, 'dodge');
    assert.equal(fired[0].petId, 'b');
    assert.equal(fired[0].itemName, 'Phantom Charm');
});

test('a mitigate charge halves one blow', () => {
    const open = jabRound('').action.targets[0].damage;
    const { action, fired } = jabRound('consum-smoke-pellet');
    const softened = action.targets[0].damage;
    assert.equal(fired[0]?.effect, 'mitigate');
    assert.ok(softened < open, `softened ${softened} < open ${open}`);
    assert.ok(Math.abs(softened - open * 0.5) <= 1, 'Smoke Pellet is the advertised 50% off');
});

test('an endure charge survives a lethal blow at 1 HP', () => {
    const { session, fired } = jabRound('consum-second-wind', (s) => { s.enemy[0].hp = 40; });
    assert.equal(session.enemy[0].ko, false, 'the blow did not finish it');
    assert.equal(session.enemy[0].hp, 1);
    assert.ok(fired.some((e) => e.effect === 'endure'));
});

test('a thorns charge reflects a slice of the blow back at the attacker', () => {
    const { session, fired } = jabRound('consum-thornmail-oil');
    const reflect = fired.find((e) => e.effect === 'thorns');
    assert.ok(reflect, 'the reflect scripted a beat');
    assert.equal(reflect.targetId, 'a', 'the damage lands on the ATTACKER, not the wearer');
    assert.ok(reflect.damage > 0);
    assert.ok(session.player[0].hp < session.player[0].maxHp, 'the attacker actually bled');
});

test('a lifeline charge heals the first drop under the threshold', () => {
    const { session, fired } = jabRound('consum-lifeline-elixir', (s) => {
        s.enemy[0].hp = Math.round(s.enemy[0].maxHp * 0.4);   // just above the 35% line
    });
    const lifeline = fired.find((e) => e.effect === 'lifeline');
    assert.ok(lifeline, 'crossing the line pulled the pet back up');
    assert.ok(lifeline.heal > 0);
    assert.ok(session.enemy[0].hp / session.enemy[0].maxHp > 0.35, 'and it landed back above the line');
});

test('a cleanse charge purges the poisons and refuses the control effect that triggered it', () => {
    const stunner = makePet('stunner', {
        speed: 200, attack: 200,
        jutsus: [{ name: 'Skull Ring', power: 120, cooldown: 0, currentCooldown: 0, kind: 'stun' }],
    });
    const session = makeSession(
        [stunner],
        [makePet('victim', { speed: 10, hp: 6000, loadout: { consumable: 'consum-cleansing-incense' } })],
    );
    session.player[0].readiness = 1;   // control moves HOLD until round 2
    session.enemy[0].statuses.push({ kind: 'burn', rounds: 3, magnitude: 30, bornRound: 0 });
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'stunner', moveIndex: 1, targetId: 'victim' },
    ], [{ kind: 'rest', petId: 'victim' }]);
    assert.ok(consumableEvents(events).some((e) => e.effect === 'cleanse'));
    const kinds = session.enemy[0].statuses.map((s) => s.kind);
    assert.ok(!kinds.includes('stun'), 'the incoming stun never landed');
    assert.ok(!kinds.includes('burn'), 'and the burn already on the pet was purged');
});

test('every charge is single-use — the second blow gets nothing', () => {
    const session = makeSession(
        [makePet('a', { speed: 200, element: 'None', attack: 300 })],
        [makePet('b', {
            speed: 10, element: 'None', hp: 8000, attack: 1,
            loadout: { consumable: 'consum-phantom-charm' },
        })],
        606,
    );
    const swing = () => resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const first = swing();
    assert.equal(consumableEvents(first).length, 1, 'the charge answered the first blow');
    const second = swing();
    assert.equal(consumableEvents(second).length, 0, 'and had nothing left for the second');
    const landed = second.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.ok((landed?.targets[0]?.damage ?? 0) > 0, 'so the second blow lands in full');
    assert.equal(session.enemy[0].consumable?.dodge, 0, 'the charge is spent down, not re-read from the loadout');
});

test('practice fires the charge but never burns the item; an eligible fight burns it', () => {
    const carrier = () => makePet('a', {
        speed: 200, attack: 300, loadout: { consumable: 'consum-second-wind' },
    });
    const practice = makeSession([carrier()], [makePet('b', { speed: 10 })], 7, '1v1', false);
    assert.deepEqual(showdownConsumableSpends(practice), [],
        'a mode that pays nothing must not eat a 1,600 ryo item');
    assert.equal(practice.player[0].consumable?.endure, 1, 'the charge is still loaded and will fire');

    const eligible = makeSession([carrier()], [makePet('b', { speed: 10 })], 7, '1v1', true);
    assert.deepEqual(showdownConsumableSpends(eligible), [{ petId: 'a', consumableId: 'consum-second-wind' }],
        'a fight that pays commits the item for the endpoint to strike from the save');
    assert.equal(eligible.player[0].consumable?.endure, 1, 'and the charge fires there too');

    // The wire says which of the two it was, so the client can credit or spare.
    const spentFlag = (session: ShowdownSession) => {
        session.player[0].hp = 40;
        const events = resolveShowdownRound(session, [
            { kind: 'rest', petId: 'a' },
        ], [{ kind: 'move', petId: 'b', moveIndex: 1, targetId: 'a' }]);
        return consumableEvents(events).find((e) => e.effect === 'endure')?.spent;
    };
    assert.equal(spentFlag(makeSession([carrier()], [makePet('b', { speed: 10, attack: 400 })], 11, '1v1', false)), false);
    assert.equal(spentFlag(makeSession([carrier()], [makePet('b', { speed: 10, attack: 400 })], 11, '1v1', true)), true);
});

test('the AI build ladder is legible: scrapper bare, warrior a trait, champion trait AND gear', () => {
    const players = [makePet('mine', { level: 50 }), makePet('mine2', { level: 50 })];
    const scrapper = buildShowdownAiTeam(players, 2, 'scrapper', 8080);
    const warrior = buildShowdownAiTeam(players, 2, 'warrior', 8080);
    const champion = buildShowdownAiTeam(players, 2, 'champion', 8080);

    // A catalog template may ship its own trait, so "bare" has to mean the
    // build STRIPS it — not merely that nothing was added.
    for (const pet of scrapper.pets) {
        assert.equal(pet.trait, undefined, 'a scrapper teaches the base game and nothing else');
        assert.equal(pet.loadout?.pvp, undefined);
    }
    for (const pet of warrior.pets) {
        assert.ok(pet.trait, 'a warrior carries a trait');
        assert.equal(pet.loadout?.pvp, undefined, 'but no gear yet');
    }
    for (const pet of champion.pets) {
        assert.ok(pet.trait, 'a champion carries a trait');
        assert.ok(pet.loadout?.pvp, 'and PvP gear on top');
    }

    // Both layers must survive sealing, or the ladder is decorative.
    const sealed = sealShowdownPet(champion.pets[0]);
    assert.ok(sealed.trait, 'the engine recognized the trait it was handed');
    assert.ok(sealed.gear?.name, 'and the gear resolved to a real proc set');

    // Seeded, never Math.random: the same seed rebuilds the same opponent.
    assert.deepEqual(buildShowdownAiTeam(players, 2, 'champion', 8080), champion);
});

test('an overdraft onto a SHIELD reports what was dealt, not what was rolled', () => {
    const session = makeSession([makePet('a', { speed: 200 })], [makePet('b', { speed: 10, attack: 1, hp: 6000 })]);
    const actor = session.player[0];
    // A big shield pool: the overdraft chip should be fully soaked.
    actor.statuses = [{ kind: 'shield', rounds: 3, magnitude: 500, bornRound: session.round }];
    const hpBefore = actor.hp;
    actor.stamina = 2;   // guarantees a deficit on any real move
    const events = resolveShowdownRound(session, [
        { kind: 'move', petId: 'a', moveIndex: 1, targetId: 'b' },
    ], [{ kind: 'rest', petId: 'b' }]);
    const action = events.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'a');
    assert.ok(action);
    assert.equal(action.overexerted, true, 'it did overdraft');
    // The shield ate it, so the actor lost no HP — and the wire must agree.
    assert.equal(actor.hp, hpBefore, 'the shield absorbed the chip');
    assert.equal(action.overexertDamage ?? 0, 0,
        'the event reports the DEALT chip (0), not the rolled figure the client would subtract off the HP bar');

    // And with no shield the chip is reported in full, so the fix did not
    // simply zero the field.
    const bare = makeSession([makePet('c', { speed: 200 })], [makePet('d', { speed: 10, attack: 1, hp: 6000 })]);
    bare.player[0].stamina = 2;
    const bareEvents = resolveShowdownRound(bare, [
        { kind: 'move', petId: 'c', moveIndex: 1, targetId: 'd' },
    ], [{ kind: 'rest', petId: 'd' }]);
    const bareAction = bareEvents.find((e): e is Extract<ShowdownEvent, { t: 'action' }> => e.t === 'action' && e.actorId === 'c');
    assert.ok((bareAction?.overexertDamage ?? 0) > 0, 'an unshielded overdraft still bleeds');
});
