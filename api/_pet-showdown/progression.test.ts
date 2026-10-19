import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../pet/_catalog.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { normalizePetGrowth } from '../pet/_growth.js';
import { petAbilitySpeciesId } from '../../shared/pet-ability-progression.js';
import { createShowdownSession, resolveShowdownRound, sealShowdownPet, sanitizeCommand, showdownStateView, estimateShowdownMoveDamage, addStatus } from './engine.js';
import { paceProgressionTechniqueDamage } from './damage-pacing.js';

const pet = (species = 'standard-0', level = 20, side = 'p'): Pet => ({ ...PET_CATALOG[species], templateId: species, id: side, level }) as Pet;
const battle = (species = 'standard-0', level = 20, count = 1) => createShowdownSession({
    sessionId: 'progression-test', playerName: 'Fixture', format: count > 1 ? '3v3' : '1v1', tier: 'warrior', seed: 123,
    playerPets: Array.from({ length: count }, (_, i) => pet(species, level, 'p' + i)),
    enemyPets: Array.from({ length: count }, (_, i) => pet(species, level, 'e' + i)), enemyTeamName: 'Fixture', rewardEligible: true,
});

test('new sessions use legal identifiable affordable kits across the complete roster and every unlock boundary', () => {
    for (const species of Object.keys(PET_CATALOG)) for (const level of [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100]) {
        const input = pet(species, level);
        const before = JSON.stringify(input);
        const sealed = sealShowdownPet(input, 'progression-v3');
        assert.equal(JSON.stringify(input), before, 'sealing cannot mutate ownership or investment');
        assert.equal(sealed.moves.length, 2 + Number(level >= 5) + Number(level >= 10), species + ':' + level);
        assert.ok(sealed.moves.every(move => move.abilityId && (move.unlockLevel ?? 0) <= level && move.cost <= sealed.maxStamina));
        assert.equal(new Set(sealed.moves.map(move => move.abilityId)).size, sealed.moves.length);
        assert.equal(sealed.signatureMove.unlockLevel, level >= 75 ? 75 : 20);
        assert.ok(Object.values(sealed).filter(value => typeof value === 'number').every(Number.isFinite));
    }
});

test('earned masteries replace their earlier technique and levels 76-100 continue stat growth', () => {
    const at = (level: number) => sealShowdownPet(pet('standard-0', level), 'progression-v3');
    const l29 = at(29), l30 = at(30), l49 = at(49), l50 = at(50), l74 = at(74), l75 = at(75), l100 = at(100);
    assert.equal(l30.moves.find(move => move.upgrade === 'utility-mastery')!.cost, l29.moves.find(move => move.unlockLevel === 5)!.cost - 4);
    assert.ok(l50.moves.find(move => move.upgrade === 'offense-mastery')!.power > l49.moves.find(move => move.unlockLevel === 10)!.power);
    assert.equal(l75.signatureMove.upgrade, 'signature-mastery');
    assert.notEqual(l74.signatureMove.abilityId, l75.signatureMove.abilityId);
    assert.deepEqual(l100.moves.map(move => move.abilityId), l75.moves.map(move => move.abilityId));
    assert.ok(l100.maxHp > l75.maxHp && l100.attack > l75.attack && l100.defense > l75.defense && l100.speed > l75.speed);
});

test('signature level and readiness gates reject stale/forged IDs with safe visible feedback', () => {
    const session = battle('standard-0', 19);
    const actor = session.player[0]; actor.meter = 100; actor.readiness = 10;
    assert.equal(sanitizeCommand(session, actor, { kind: 'super', petId: actor.id, targetId: 'e0' }).kind, 'guard');
    const events = resolveShowdownRound(session, [{ kind: 'move', petId: actor.id, targetId: 'e0', moveIndex: 1, abilityId: 'forged:signature' }], [{ kind: 'rest', petId: 'e0' }]);
    assert.ok(events.some(event => event.t === 'action' && event.actorId === actor.id && event.moveKind === 'guard'));
    assert.ok(showdownStateView(session).commandFeedback?.some(message => message.includes('unavailable')));
    const earned = battle('standard-0', 20); earned.player[0].meter = 100; earned.player[0].readiness = 2;
    assert.equal(sanitizeCommand(earned, earned.player[0], { kind: 'super', petId: 'p0', targetId: 'e0', abilityId: earned.player[0].signatureMove.abilityId }).kind, 'super');
});

test('healing is bounded and reuse survives serialization at the exact next legal round', () => {
    let session = battle('standard-3', 5);
    const actor = session.player[0]; actor.hp = actor.maxHp / 2;
    const index = actor.moves.findIndex(move => move.kind === 'heal'); assert.ok(index >= 0);
    const order = { kind: 'move' as const, petId: 'p0', targetId: 'p0', moveIndex: index, abilityId: actor.moves[index].abilityId };
    const events = resolveShowdownRound(session, [order], [{ kind: 'rest', petId: 'e0' }]);
    const action = events.find(event => event.t === 'action' && event.actorId === 'p0');
    assert.ok(action?.t === 'action'); assert.ok(action.targets[0].heal <= Math.ceil(actor.maxHp * .175));
    session = JSON.parse(JSON.stringify(session));
    assert.equal(session.player[0].moves[index].availableAtRound, 4);
    for (let round = 2; round < 4; round++) {
        session.round = round;
        assert.equal(sanitizeCommand(session, session.player[0], order).kind, 'guard');
    }
    session.round = 4; assert.equal(sanitizeCommand(session, session.player[0], order).kind, 'move');
});

test('shields replace their pool, expire after two rounds and control resistance survives the condition cap', () => {
    const session = battle(); session.round = 1;
    const target = session.player[0];
    addStatus(session, target, 'shield', 2, 100); addStatus(session, target, 'shield', 2, 70);
    assert.equal(target.statuses.find(status => status.kind === 'shield')!.magnitude, 70);
    addStatus(session, target, 'stun', 1, 1); addStatus(session, target, 'freeze', 1, 1);
    assert.equal(target.statuses.some(status => status.kind === 'freeze'), false);
    addStatus(session, target, 'burn', 2, 2); addStatus(session, target, 'wound', 2, 2);
    assert.ok(target.statuses.some(status => status.kind === 'steadfast'));
    resolveShowdownRound(session, [{ kind: 'rest', petId: 'p0' }], [{ kind: 'rest', petId: 'e0' }]);
    assert.equal(target.statuses.some(status => status.kind === 'shield'), false);
});

test('forecasts cannot consume marks, resources or RNG and growth retains marginal offense and defense', () => {
    for (const species of ['standard-0', 'legendary-2']) {
        const session = battle(species, 75), actor = session.player[0], target = session.enemy[0];
        target.statuses.push({ kind: 'mark', rounds: 3, magnitude: 1.25, bornRound: 0 });
        const before = JSON.stringify(session);
        const base = estimateShowdownMoveDamage(session, actor, target, actor.moves[1]);
        assert.equal(JSON.stringify(session), before);
        const stronger = { ...actor, attack: actor.attack * 1.1, spAttack: actor.spAttack * 1.1 };
        const guarded = { ...target, defense: target.defense * 1.1, spDefense: target.spDefense * 1.1 };
        assert.ok(estimateShowdownMoveDamage(session, stronger, target, actor.moves[1]) > base);
        assert.ok(estimateShowdownMoveDamage(session, actor, guarded, actor.moves[1]) < base);
    }
    assert.equal(paceProgressionTechniqueDamage(200, 400, 75, 75), 200);
    assert.equal(paceProgressionTechniqueDamage(220, 400, 75, 75) - paceProgressionTechniqueDamage(200, 400, 75, 75), 20);
});

test('team signatures share one total damage budget and preparation rewards the final mastery', () => {
    const hit = (count: number, prepared = false) => {
        const session = battle('starter-fire-l', 75, count), actor = session.player[0];
        actor.meter = 100; actor.readiness = 3;
        if (prepared) actor.statuses.push({ kind: 'buff', rounds: 2, magnitude: 1.25, bornRound: 0 });
        const events = resolveShowdownRound(session, [{ kind: 'super', petId: 'p0', targetId: 'e0' }], session.enemy.map(pet => ({ kind: 'rest', petId: pet.id })));
        const action = events.find(event => event.t === 'action' && event.actorId === 'p0');
        assert.ok(action?.t === 'action'); return action.targets.reduce((sum, target) => sum + target.damage, 0);
    };
    const single = hit(1); assert.ok(single > 0);
    assert.ok(hit(3) <= single * 1.15, 'three targets do not multiply a full strike budget');
    assert.ok(hit(1, true) > single, 'visible setup improves a mastered signature');
});

test('only actual field contributions qualify, including a front pet defeated before its action', () => {
    const session = battle('standard-0', 20); session.player.push({ ...session.player[0], id: 'bench', benched: true });
    session.player[0].hp = 1; session.enemy[0].speed = 10000;
    resolveShowdownRound(session, [{ kind: 'rest', petId: 'p0' }], [{ kind: 'move', petId: 'e0', targetId: 'p0', moveIndex: 1 }]);
    assert.ok(session.participationIds?.includes('p0')); assert.ok(!session.participationIds?.includes('bench'));
});

test('four owned attributes preserve their allocation without an extra currency or happiness combat roll', () => {
    const raw = normalizePetGrowth({ ...pet('standard-0', 75), growthAllocation: { vitality: 20, power: 20, guard: 20, agility: 14 }, happiness: 0 });
    const before = JSON.stringify(raw);
    const low = sealShowdownPet(raw as unknown as Pet, 'progression-v3');
    const happy = sealShowdownPet({ ...raw, happiness: 100 } as unknown as Pet, 'progression-v3');
    assert.equal(JSON.stringify(raw), before); assert.deepEqual(low, happy);
    assert.equal(petAbilitySpeciesId({ templateId: 'starter-fire', evolutionStage: 2 }), 'starter-fire-l');
});

test('equivalent evolved identities normalize to the same form and excess Guard never buys stamina', () => {
    const raw = { ...pet('starter-fire-r', 50), templateId: 'starter-fire', evolutionStage: 1 } as Pet;
    const a = sealShowdownPet(raw, 'progression-v3');
    const b = sealShowdownPet({ ...raw, templateId: 'starter-fire-r' }, 'progression-v3');
    assert.deepEqual(a, b);
    const corrupt = { ...pet('standard-0', 100), growthAllocation: { vitality: 50, power: 49, guard: 50, agility: 0 } } as Pet;
    const legal = normalizePetGrowth(corrupt as unknown as Record<string, unknown>);
    assert.equal(sealShowdownPet(corrupt, 'progression-v3').maxStamina, sealShowdownPet(legal as unknown as Pet, 'progression-v3').maxStamina);
});

test('an expired reserve shield and an unavailable or recovering signature cannot be reused', () => {
    const session = battle(); const actor = session.player[0];
    session.player.push({ ...actor, id: 'bench', benched: true, statuses: [{ kind: 'shield', magnitude: 500, rounds: 2, bornRound: 0, expiresAfterRound: 1 }] });
    session.round = 2;
    resolveShowdownRound(session, [{ kind: 'switch', petId: actor.id, benchPetId: 'bench' }], [{ kind: 'rest', petId: 'e0' }]);
    assert.equal(session.player[1].statuses.some(s => s.kind === 'shield'), false);
    actor.meter = 100; actor.readiness = 10; actor.signatureMove.availableAtRound = 99;
    assert.equal(sanitizeCommand(session, actor, { kind: 'super', petId: actor.id, targetId: 'e0' }).kind, 'guard');
    actor.signatureMove.availableAtRound = 0; actor.signatureMove.abilityId = 'unavailable:signature';
    assert.equal(sanitizeCommand(session, actor, { kind: 'super', petId: actor.id, targetId: 'e0' }).kind, 'guard');
});

test('the final mastery improves actual support execution with identical combat stats', () => {
    const cast = (kind: string, mastered: boolean) => {
        const session = battle('standard-0', 75, kind === 'taunt' ? 3 : 1);
        const actor = session.player[0]; actor.hp = actor.maxHp / 2; actor.meter = 100; actor.readiness = 10;
        actor.signatureMove = { ...actor.signatureMove, kind, upgrade: mastered ? 'signature-mastery' : undefined };
        if (kind === 'cleanse') actor.statuses.push({ kind: 'burn', magnitude: 1, rounds: 2, bornRound: 0 });
        const events = resolveShowdownRound(session, [{ kind: 'super', petId: 'p0', targetId: 'p0' }], session.enemy.map(pet => ({ kind: 'rest', petId: pet.id })));
        return { actor, session, events };
    };
    for (const kind of ['buff', 'haste']) {
        assert.equal(cast(kind, false).actor.statuses.find(s => s.kind === kind)!.magnitude, 1.25);
        assert.equal(cast(kind, true).actor.statuses.find(s => s.kind === kind)!.magnitude, 1.3);
    }
    const ordinaryBuff = cast('buff', false), masteredBuff = cast('buff', true);
    assert.ok(estimateShowdownMoveDamage(masteredBuff.session, masteredBuff.actor, masteredBuff.session.enemy[0], masteredBuff.actor.moves[0])
        > estimateShowdownMoveDamage(ordinaryBuff.session, ordinaryBuff.actor, ordinaryBuff.session.enemy[0], ordinaryBuff.actor.moves[0]), 'mastery must improve the executed follow-up, not only status metadata');
    assert.ok(showdownStateView(cast('haste', true).session).player[0].speed > showdownStateView(cast('haste', false).session).player[0].speed, 'haste mastery changes effective initiative');
    for (const kind of ['shield', 'barrier', 'absorb']) {
        assert.ok(cast(kind, true).actor.statuses.find(s => s.kind === 'shield')!.magnitude > cast(kind, false).actor.statuses.find(s => s.kind === 'shield')!.magnitude);
    }
    assert.ok(cast('heal', true).actor.hp > cast('heal', false).actor.hp);
    assert.ok(cast('weather', true).session.weather!.until > cast('weather', false).session.weather!.until);
    assert.ok(cast('taunt', true).actor.statuses.find(s => s.kind === 'taunt')!.rounds > cast('taunt', false).actor.statuses.find(s => s.kind === 'taunt')!.rounds);
    assert.ok(cast('cleanse', true).actor.statuses.some(s => s.kind === 'steadfast'));
    assert.ok(!cast('cleanse', false).actor.statuses.some(s => s.kind === 'steadfast'));
});

