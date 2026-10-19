import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pet, PetJutsu } from '../types/pet';
import { createLiveCinematicDuel, createLivePartyCinematicDuel, stepCinematicDuel, applyDuelCommand, petCinematicDodgeChance, runPetSquadDuelCinematic } from './pet-duel-cinematic';
import { createLiveCinematicDuel as createServer, createLivePartyCinematicDuel as createServerParty, stepCinematicDuel as stepServer, runPetSquadDuelCinematic as runServerSquad } from '../../../api/_pet-sim/pet-duel-cinematic';
import { DUEL_TPS } from './pet-duel-sim';
import { tacticsPreset } from '../../../shared/pet-tactics-roster';

const art = (kind: PetJutsu['kind']): PetJutsu => ({ name: 'Companion Art', kind, power: 100,
    cooldown: 0, currentCooldown: 0, abilityId: 'fixture:companion-art:utility' });
const pet = (kind: PetJutsu['kind'], version: Pet['battleLoadoutVersion'] = 'progression-v3'): Pet => ({
    id: 'effect-fixture', name: 'Companion', rarity: 'standard', level: 75, xp: 0, maxLevel: 100,
    hp: 1000, attack: 100, defense: 40, speed: 40, jutsus: [art(kind)], unlockedForPve: true,
    battleLoadoutVersion: version,
});
for (const [name, create, step] of [['client', createLiveCinematicDuel, stepCinematicDuel], ['server', createServer, stepServer]] as const) {
    const fixture = (kind: PetJutsu['kind'], version: Pet['battleLoadoutVersion'] = 'progression-v3', abilityId?: string) => {
        const source = pet(kind, version);
        if (abilityId) { source.jutsus[0].abilityId = abilityId; source.jutsus[0].signature = abilityId.includes(':signature'); }
        const sim = create(source, pet('damage', version), 23, 1, 1, false, false, false, null, false, false);
        for (const fighter of sim.fighters) { fighter.state = 'recover'; fighter.stateLeft = 1000; }
        sim.fighters[0].x = -6; sim.fighters[1].x = 6;
        sim.fighters[0].y = 0; sim.fighters[1].y = 0;
        return sim;
    };
    const cast = (sim: ReturnType<typeof fixture>) => {
        const fighter = sim.fighters[0];
        fighter.state = 'windup'; fighter.stateLeft = 1; fighter.pendingIdx = 0; fighter.pendingTargetId = fighter.id;
        step(sim);
    };
    const hit = (sim: ReturnType<typeof fixture>, budgetScale = 1, abilityIdx = 0) => {
        const [owner, target] = sim.fighters;
        sim.projectiles.push({ id: sim.nextProjId.n++, ownerId: owner.id, team: owner.team,
            targetId: target.id, abilityIdx, x: target.x, y: target.y, speed: 0, ttl: 10,
            kind: owner.abilities[0].kind, budgetScale });
        step(sim);
    };
    test(name + ': new spatial support is bounded and shields expire without stacking', () => {
        const heal = fixture('heal'); const fighter = heal.fighters[0]; fighter.hp = fighter.maxHp * .2;
        const before = fighter.hp; cast(heal);
        assert.ok(fighter.hp - before <= Math.ceil(fighter.maxHp * .175));
        assert.ok(fighter.hp > before);
        assert.ok(fighter.abilities[0].cdTicks >= DUEL_TPS * 3);
        const shield = fixture('shield'); cast(shield);
        const value = shield.fighters[0].statuses.shieldHp;
        assert.equal(value, Math.round(shield.fighters[0].maxHp * .225));
        cast(shield);
        assert.equal(shield.fighters[0].statuses.shieldHp, value);
        for (let i = 0; i < DUEL_TPS * 4 + 1; i++) step(shield);
        assert.equal(shield.fighters[0].statuses.shieldHp, 0);
    });
    test(name + ': control cannot refresh during resistance and area hits share one budget', () => {
        const control = fixture('stun'); hit(control);
        const target = control.fighters[1]; const first = target.statuses.stunLeft;
        assert.ok(first > 0);
        hit(control);
        assert.ok(target.statuses.stunLeft < first, 'second hit does not refresh denied time');
        const full = fixture('damage'); const split = fixture('damage');
        hit(full); hit(split, .5);
        const fullDamage = full.events.find(event => event.type === 'hit')!.dmg!;
        const splitDamage = split.events.find(event => event.type === 'hit')!.dmg!;
        assert.ok(splitDamage <= Math.ceil(fullDamage / 2));
    });
    test(name + ': legacy support retains its recorded healing behavior', () => {
        const legacy = fixture('heal', 'legacy-v1'); const fighter = legacy.fighters[0]; fighter.hp = fighter.maxHp * .2;
        const before = fighter.hp; cast(legacy);
        assert.ok(fighter.hp - before > fighter.maxHp * .3);
        assert.equal(fighter.pet.battleLoadoutVersion, 'legacy-v1');
    });
    test(name + ': Guard retains marginal survival value above the old defensive ceiling', () => {
        const low = fixture('damage'); const high = fixture('damage');
        low.fighters[1].def = 800; high.fighters[1].def = 1000;
        hit(low); hit(high);
        assert.ok(high.fighters[1].hp > low.fighters[1].hp);
    });
    test(name + ': earned attack tiers deliver more actual damage than the ordinary fallback', () => {
        const ordinary = fixture('damage'); hit(ordinary, 1, -1);
        const basic = fixture('damage', 'progression-v3', 'species:art:basic'); hit(basic);
        const advanced = fixture('damage', 'progression-v3', 'species:art:advanced'); hit(advanced);
        const signature = fixture('damage', 'progression-v3', 'species:art:signature'); hit(signature);
        const dealt = (sim: typeof ordinary) => sim.events.find(event => event.type === 'hit')!.dmg!;
        assert.ok(dealt(basic) > dealt(ordinary));
        assert.ok(dealt(advanced) > dealt(basic));
        assert.ok(dealt(signature) > dealt(advanced));
        assert.ok(signature.fighters[0].abilities[0].cost <= 100);
        assert.ok(signature.fighters[0].abilities[0].cdLeft >= DUEL_TPS * 4, 'the signature has visible preparation');
    });
    test(name + ': learned melee resolves at body-edge contact while dodges and distance still counter it', () => {
        const contact = (version: Pet['battleLoadoutVersion'], gap: number, dodge = false) => {
            const sim = fixture('damage', version, 'species:art:basic');
            const [actor, target] = sim.fighters;
            actor.x = -gap / 2; target.x = gap / 2;
            actor.maxSpeed = 0; target.maxSpeed = 0; actor.maxForce = 0; target.maxForce = 0;
            actor.faceX = 1; actor.faceY = 0;
            actor.state = 'dash'; actor.stateLeft = 1; actor.lungeAbIdx = 0; actor.lungeTgtId = target.id;
            actor.moveDx = 1; actor.moveDy = 0;
            if (dodge) { target.state = 'dodge'; target.stateLeft = 1000; }
            step(sim); return sim;
        };
        assert.ok(contact('progression-v3', 2.4).events.some(event => event.type === 'hit' && event.move === 'Companion Art'));
        assert.equal(contact('legacy-v1', 2.4).events.some(event => event.type === 'hit'), false, 'retained strict contact stays unchanged');
        assert.equal(contact('progression-v3', 3.1).events.some(event => event.type === 'hit'), false, 'outside the body-edge pocket still misses');
        assert.equal(contact('progression-v3', 2.4, true).events.some(event => event.type === 'hit'), false, 'a genuine dodge still counters the committed art');
    });
    test(name + ': a blocked learned approach returns to ordinary pressure', () => {
        const sim = fixture('damage', 'progression-v3', 'species:art:basic');
        const [actor, target] = sim.fighters;
        actor.x = -2.5; target.x = 2.5; actor.state = 'idle';
        actor.maxSpeed = 0; actor.maxForce = 0; target.maxSpeed = 0; target.maxForce = 0;
        actor.abilities[0].cdLeft = 0; actor.basicCdLeft = 0; actor.basicRanged = true;
        for (let tick = 0; tick < DUEL_TPS * 7; tick++) step(sim);
        assert.ok(sim.events.some(event => event.actorId === actor.id && event.type === 'hit' && !event.move));
        assert.equal(sim.events.some(event => event.actorId === actor.id && event.type === 'hit' && event.move === 'Companion Art'), false);
    });

    test(name + ': equal-stat level-75 support mastery changes the executed effect', () => {
        for (const kind of ['heal', 'shield', 'buff', 'haste', 'cleanse'] as const) {
            const base = fixture(kind), mastered = fixture(kind);
            for (const sim of [base, mastered]) {
                sim.fighters[0].abilities[0].signature = true;
                sim.fighters[0].hp = sim.fighters[0].maxHp * .2;
                sim.fighters[0].statuses.slowLeft = 300;
            }
            mastered.fighters[0].abilities[0].mastery = true;
            cast(base); cast(mastered);
            const a = base.fighters[0], b = mastered.fighters[0];
            if (kind === 'heal') { assert.equal(a.hp, a.maxHp * .2 + Math.round(a.maxHp * .175)); assert.equal(b.hp, b.maxHp * .2 + Math.round(b.maxHp * .2)); }
            if (kind === 'shield') { assert.equal(a.statuses.shieldHp, Math.round(a.maxHp * .225)); assert.equal(b.statuses.shieldHp, Math.round(b.maxHp * .25)); }
            if (kind === 'buff') { assert.equal(a.statuses.buffMag, .25); assert.ok(Math.abs(b.statuses.buffMag - .3) < 1e-9); }
            if (kind === 'haste') assert.equal(b.statuses.hasteLeft - a.statuses.hasteLeft, DUEL_TPS);
            if (kind === 'cleanse') { assert.equal(a.statuses.slowLeft, 0); assert.ok((b.statuses.controlResistLeft ?? 0) > 0); }
        }
    });
    test(name + ': area lingering damage shares its action budget over exactly two ticks', () => {
        const full = fixture('burn'), split = fixture('burn');
        const initial = full.fighters[1].hp;
        hit(full); hit(split, .5);
        const fullDirect = full.events.find(event => event.type === 'hit')!.dmg!;
        const splitDirect = split.events.find(event => event.type === 'hit')!.dmg!;
        let fullTicks = Number(full.fighters[1].hp < initial - fullDirect);
        let splitTicks = Number(split.fighters[1].hp < initial - splitDirect);
        for (let i = 0; i < DUEL_TPS; i++) {
            const a = full.fighters[1].hp, b = split.fighters[1].hp;
            step(full); step(split);
            fullTicks += Number(full.fighters[1].hp < a); splitTicks += Number(split.fighters[1].hp < b);
        }
        const lingering = initial - full.fighters[1].hp - fullDirect;
        const shared = initial - split.fighters[1].hp - splitDirect;
        assert.equal(fullTicks, 2); assert.equal(splitTicks, 2);
        assert.ok(shared <= Math.ceil(lingering / 2));
        assert.ok(lingering <= full.fighters[1].maxHp * .1);
    });
    test(name + ': new lifesteal cannot heal from overkill damage', () => {
        const sim = fixture('lifesteal');
        const actor = sim.fighters[0]; actor.hp = actor.maxHp * .2;
        const before = actor.hp; sim.fighters[1].hp = 1;
        hit(sim);
        assert.ok(actor.hp - before <= 1, 'one remaining enemy HP cannot pay a full-hit heal');
    });
}

test('ranged team casts seal one total damage budget across their targets', () => {
    const source = pet('burn'); source.jutsus[0].aoe = true;
    const sim = createLivePartyCinematicDuel(source, null, pet('damage'), pet('damage'), 23, 1, 1, false, false, false, false, false);
    for (const fighter of sim.fighters) { fighter.state = 'recover'; fighter.stateLeft = 1000; }
    const actor = sim.fighters[0];
    actor.state = 'windup'; actor.stateLeft = 1; actor.pendingIdx = 0; actor.pendingTargetId = sim.fighters[1].id;
    stepCinematicDuel(sim);
    const shots = sim.projectiles.filter(projectile => projectile.ownerId === actor.id);
    assert.equal(shots.length, 2);
    assert.equal(shots.reduce((sum, projectile) => sum + (projectile.budgetScale ?? 1), 0), 1);
});

test('fresh low-level cinematic commands cannot select locked or malformed abilities', () => {
    const novice = { ...pet('damage'), id: 'owned-wind', templateId: 'starter-wind', level: 1, battleLoadoutVersion: undefined };
    const sim = createLiveCinematicDuel(novice, pet('damage'), 23);
    assert.equal(sim.fighters[0].abilities.length, 1);
    for (const idx of [1, 4, NaN, .5, -2]) assert.equal(applyDuelCommand(sim, { kind: 'ability', actorId: 'player-0', idx }), false);
    assert.equal(applyDuelCommand(sim, { kind: 'break', actorId: 'player-0' }), false);
});

test('earned progression commands resolve the selected stable identity after unlocks', () => {
    for (const level of [5, 10, 20, 30, 50, 75, 100]) {
        const source: Pet = { ...pet('damage'), id: 'owned-water', templateId: 'starter-water', level,
            battleLoadoutVersion: undefined, rankedBuild: { ...tacticsPreset('starter-water', 1), ownedPetId: 'owned-water' } };
        const sim = createLiveCinematicDuel(source, pet('damage'), 23);
        const fighter = sim.fighters[0];
        const eligible = fighter.pet.jutsus;
        assert.ok(eligible.every(move => (move.unlockLevel ?? 1) <= level));
        assert.ok(eligible.every(move => !!move.abilityId));
        const chosen = fighter.abilities.findIndex(move => !move.signature);
        assert.equal(applyDuelCommand(sim, { kind: 'ability', actorId: fighter.id, idx: chosen }), true);
        assert.equal(fighter.cmdIdx, chosen);
        assert.equal(fighter.abilities[chosen].name, eligible[chosen].name);
    }
});



test('progression Agility changes neither random reaction nor projectile evasion odds', () => {
    for (const speed of [1, 40, 80, 120, 200]) {
        assert.equal(petCinematicDodgeChance('progression-v3', .22, speed, 40, .0022, .05, .85), .22);
        assert.equal(petCinematicDodgeChance('progression-v3', .10, speed, 40, .002, 0, .6), .10);
    }
    assert.ok(petCinematicDodgeChance('legacy-v1', .22, 200, 40, .0022, .05, .85) > .22);
    assert.equal(petCinematicDodgeChance(undefined, .22, 200, 40, .0022, .05, .85), petCinematicDodgeChance('legacy-v1', .22, 200, 40, .0022, .05, .85));
});

test('crossing the old speed-90 threshold cannot buy progression dodge disposition', () => {
    const source: Pet = { ...pet('damage'), role: 'tracker', attack: 100, defense: 40,
        growthBaseStats: { hp: 1000, attack: 100, defense: 40, speed: 40 },
        jutsus: [art('damage'), art('burn')] };
    const low = createLiveCinematicDuel({ ...source, speed: 89 }, pet('damage'), 23).fighters[0];
    const high = createLiveCinematicDuel({ ...source, speed: 91 }, pet('damage'), 23).fighters[0];
    assert.equal(high.style.arche, low.style.arche);
    assert.equal(high.style.dodgeBias, low.style.dodgeBias);
    assert.ok(high.maxSpeed > low.maxSpeed);
    assert.ok(high.windT <= low.windT);
    const legacyLow = createLiveCinematicDuel({ ...source, speed: 89, battleLoadoutVersion: 'legacy-v1' }, pet('damage'), 23).fighters[0];
    const legacyHigh = createLiveCinematicDuel({ ...source, speed: 91, battleLoadoutVersion: 'legacy-v1' }, pet('damage'), 23).fighters[0];
    assert.notEqual(legacyLow.style.arche, legacyHigh.style.arche, 'retained snapshots preserve their historical threshold');
});

for (const [name, run] of [['client', runPetSquadDuelCinematic], ['server', runServerSquad]] as const) {
    const formation = (kind: 'buff' | 'haste', mastered: boolean, version: Pet['battleLoadoutVersion'] = 'progression-v3') => {
        const source: Pet = { ...pet(kind, version), role: 'sage', level: mastered ? 75 : 74,
            hp: 10000, attack: 100, defense: 40, speed: 90,
            jutsus: [{ ...art(kind), name: 'Final Art', power: mastered ? 110 : 100, cooldown: 100,
                signature: true, abilityId: 'fixture:art:signature' + (mastered ? ':mastery-75' : '') }] };
        const other: Pet = { ...source, role: 'defender', jutsus: [] };
        return run([source, other], [other, other], 20, false, false, false, [4, 5], [4, 5]);
    };
    test(name + ': formation Buff strengthens actual follow-up damage at the final mastery', () => {
        const base = formation('buff', false), mastery = formation('buff', true);
        const afterCast = (result: ReturnType<typeof formation>) => {
            const cast = result.events.find(event => event.type === 'buff' && event.actorId === 'player-0' && event.move === 'Final Art');
            assert.ok(cast, 'the formation must execute Buff as a stance');
            assert.equal(result.events.some(event => event.type === 'shield' && event.actorId === 'player-0' && event.move === 'Final Art'), false);
            const hit = result.events.find(event => event.type === 'hit' && event.actorId === 'player-0' && event.t > cast.t);
            assert.ok(hit?.dmg);
            return hit;
        };
        const baseHit = afterCast(base), masteredHit = afterCast(mastery);
        assert.equal(masteredHit.t, baseHit.t, 'only the stance magnitude changes in the equal-stat fixture');
        assert.equal(masteredHit.crit, baseHit.crit);
        assert.ok(masteredHit.dmg! > baseHit.dmg!, '30% stance must deal more damage than 25%');
        const retained = formation('buff', true, 'legacy-v1');
        assert.ok(retained.events.some(event => event.type === 'shield' && event.actorId === 'player-0' && event.move === 'Final Art'));
        assert.equal(retained.events.some(event => event.type === 'buff' && event.actorId === 'player-0' && event.move === 'Final Art'), false);
    });
    test(name + ': formation Haste grants its real status for one extra second at the final mastery', () => {
        const activeTicks = (result: ReturnType<typeof formation>) => {
            assert.ok(result.events.some(event => event.type === 'buff' && event.actorId === 'player-0' && event.kind === 'haste' && event.move === 'Final Art'));
            assert.equal(result.events.some(event => event.type === 'shield' && event.actorId === 'player-0' && event.move === 'Final Art'), false);
            return result.snapshots.filter(snapshot => snapshot.actors.find(actor => actor.id === 'player-0')?.statuses.includes('haste')).length;
        };
        const base = activeTicks(formation('haste', false)), mastery = activeTicks(formation('haste', true));
        assert.ok(base > 0);
        assert.equal(mastery - base, DUEL_TPS);
        const retained = formation('haste', true, 'legacy-v1');
        assert.ok(retained.events.some(event => event.type === 'shield' && event.actorId === 'player-0' && event.move === 'Final Art'));
        assert.equal(retained.snapshots.some(snapshot => snapshot.actors.find(actor => actor.id === 'player-0')?.statuses.includes('haste')), false);
    });
}

for (const [name, createParty, step] of [['client', createLivePartyCinematicDuel, stepCinematicDuel], ['server', createServerParty, stepServer]] as const) {
    const party = (version: Pet['battleLoadoutVersion']) => {
        const source = pet('damage', version);
        source.jutsus[0].abilityId = 'species:earned-strike:basic';
        const sim = createParty(source, source, source, source, 23, 1, 1, false, false, false, true, false);
        for (const fighter of sim.fighters) {
            fighter.state = 'idle'; fighter.reposLeft = 0; fighter.routeActive = false;
            fighter.maxSpeed = 0; fighter.maxForce = 0; fighter.y = 0;
            fighter.dodgeCd = DUEL_TPS * 10; // Isolate initiative permission; dedicated tests retain real dodge counterplay.
            fighter.abilities[0].cdLeft = 0; fighter.basicCdLeft = 0;
            fighter.x = fighter.team === 'player' ? -1.2 : 1.2;
            fighter.faceX = fighter.team === 'player' ? 1 : -1; fighter.faceY = 0;
        }
        return sim;
    };
    test(name + ': opposite-slot survivors share a living initiative lane without waiting for stall override', () => {
        for (const version of ['legacy-v1', 'progression-v3'] as const) {
            const sim = party(version);
            for (const fighter of sim.fighters) if (fighter.id === 'player-1' || fighter.id === 'enemy-0') {
                fighter.hp = 0; fighter.state = 'dead';
            }
            sim.laneInitiative = ['enemy', 'player', 'enemy', 'player'];
            for (let tick = 0; tick < DUEL_TPS * 5; tick++) step(sim);
            const hits = sim.events.filter(event => event.type === 'hit');
            if (version === 'legacy-v1') {
                assert.equal(hits.length, 0, 'retained original-slot arbitration remains exact');
                assert.equal(sim.events.filter(event => event.type === 'windup').length, 0);
            }
            else {
                assert.ok(sim.events.filter(event => event.type === 'windup').length >= 2, 'ready living opponents must begin attacks before the eighteen-second stall override');
                assert.equal(sim.forcedEngage, false, 'normal initiative resolves the exchange with counterplay intact');
                assert.ok(sim.events.some(event => event.type === 'windup' && event.actorId === 'player-0'));
                assert.ok(sim.events.some(event => event.type === 'windup' && event.actorId === 'enemy-1'));
            }
        }
    });
    test(name + ': a collapsed 2v1 handoff reaches the surviving contested lane', () => {
        const sim = party('progression-v3');
        const player = sim.fighters.find(fighter => fighter.id === 'player-0')!;
        const ally = sim.fighters.find(fighter => fighter.id === 'player-1')!;
        const defeated = sim.fighters.find(fighter => fighter.id === 'enemy-0')!;
        const target = sim.fighters.find(fighter => fighter.id === 'enemy-1')!;
        defeated.hp = 0; defeated.state = 'dead';
        player.state = 'recover'; player.stateLeft = 1;
        ally.state = 'recover'; ally.stateLeft = DUEL_TPS * 10;
        sim.laneInitiative = ['player', 'player', 'enemy', 'player'];
        step(sim);
        assert.equal(sim.laneInitiative[1], 'enemy', 'the opponent listens to its living contested lane');
        assert.equal(sim.laneInitiative[0], 'player', 'an empty original lane receives no unusable handoff');
        assert.ok(sim.events.some(event => event.type === 'windup' && event.actorId === target.id));
    });
    test(name + ': intact party openings retain their two independent initiative lanes', () => {
        const sim = party('progression-v3');
        for (const fighter of sim.fighters) {
            fighter.y = fighter.slot * 6;
            fighter.targetId = fighter.team === 'player' ? 'enemy-' + fighter.slot : 'player-' + fighter.slot;
        }
        sim.laneInitiative = ['player', 'enemy', 'enemy', 'player'];
        step(sim);
        const openers = sim.events.filter(event => event.type === 'windup').map(event => event.actorId).sort();
        assert.deepEqual(openers, ['enemy-1', 'player-0']);
        assert.deepEqual(sim.laneInitiative.slice(0, 2), ['player', 'enemy']);
    });
}
