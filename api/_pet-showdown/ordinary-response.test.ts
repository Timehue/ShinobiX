import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../pet/_catalog.js';
import { growthPointsEarned, sanitizeGrowthAllocation, type PetGrowthAllocation } from '../pet/_growth.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import type { ShowdownCommand } from '../../shared/pet-showdown-contract.js';
import { createShowdownSession, resolveShowdownRound } from './engine.js';

const balanced = (level: number): PetGrowthAllocation => {
    const earned = growthPointsEarned(level), each = Math.floor(earned / 4);
    const result = { vitality: each, power: each, guard: each, agility: each };
    const attributes = ['vitality', 'power', 'guard', 'agility'] as const;
    for (let i = 0; i < earned % 4; i++) result[attributes[i]]++;
    return result;
};
function fixture(level: number, allocation = balanced(level)): Pet {
    const template = PET_CATALOG['starter-lightning'];
    return { ...template, id: 'starter-lightning', templateId: 'starter-lightning', level, trait: undefined, growthVersion: 2,
        growthBaseStats: { hp: template.hp, attack: template.attack, defense: template.defense, speed: template.speed },
        growthAllocation: allocation } as Pet;
}
function opening(level: number, advanced: boolean, sourceAllocation = balanced(level), targetAllocation = balanced(level),
    seed = 130363, mirrored = false) {
    const session = createShowdownSession({
        sessionId: 'ordinary-response-regression', playerName: 'Evidence', format: '1v1', tier: 'warrior', seed,
        playerPets: [{ ...fixture(level, targetAllocation), id: 'target' }],
        enemyPets: [{ ...fixture(level, sourceAllocation), id: 'source' }],
        enemyTeamName: 'Evidence', rulesetVersion: 'progression-v3', rewardEligible: false,
    });
    const source = session.enemy[0], target = session.player[0];
    const index = source.moves.findIndex(move => move.abilityId?.includes(advanced ? ':advanced' : ':basic'));
    const responseIndex = mirrored ? target.moves.findIndex(move => move.abilityId?.includes(advanced ? ':advanced' : ':basic')) : 0;
    assert.ok(index >= 0 && responseIndex >= 0);
    const move = structuredClone(source.moves[index]);
    const sourceBefore = structuredClone(source), targetBefore = structuredClone(target);
    const attack: ShowdownCommand = { kind: 'move', petId: source.id, moveIndex: index, targetId: target.id };
    const response: ShowdownCommand = { kind: 'move', petId: target.id, moveIndex: responseIndex, targetId: source.id };
    const events = resolveShowdownRound(session, [response], [attack]);
    const action = events.find(event => event.t === 'action' && event.actorId === source.id);
    assert.ok(action?.t === 'action');
    const hit = action.targets.find(target => target.id === targetBefore.id);
    assert.ok(hit);
    return { session, sourceBefore, targetBefore, move, action, hit, events, source, target };
}

test('natural Spark Pup ordinary openings preserve a response without charge, meter or equipment', () => {
    for (const level of [1, 10, 20, 75, 100]) for (const seed of [104729, 130363]) {
        for (const advanced of level >= 10 ? [false, true] : [false]) {
            const result = opening(level, advanced, undefined, undefined, seed, true);
            assert.equal(result.sourceBefore.readiness, 0);
            assert.equal(result.sourceBefore.meter, 0);
            assert.equal(result.sourceBefore.trait, undefined);
            assert.equal(result.sourceBefore.gear, undefined);
            assert.equal(result.sourceBefore.consumable, undefined);
            assert.equal(result.move.hold, 0);
            assert.equal(result.move.kind, 'damage');
            assert.ok(result.move.cost <= result.sourceBefore.stamina);
            assert.equal(result.move.cost, advanced ? level >= 50 ? 36 : 32 : 18);
            assert.equal(result.action.moveName, 'Jolt Bite');
            assert.equal(result.action.super, false);
            assert.equal(result.action.overexerted, false);
            assert.ok(result.hit.damage > 0);
            assert.ok(result.hit.damage <= Math.ceil(result.targetBefore.maxHp * .65));
            assert.equal(result.hit.effectiveness, 'neutral');
            assert.equal(result.hit.guarded, false);
            assert.equal(result.hit.ko, false);
            assert.deepEqual(result.hit.procs, ['STAB']);
            assert.equal(result.events.filter(event => event.t === 'action' && event.moveName === 'Jolt Bite').length, 2);
            assert.equal(result.session.finished, false);
        }
    }
});

test('earned advanced Jolt Bite remains stronger than the affordable native basic', () => {
    for (const level of [10, 20, 75, 100]) {
        const basic = opening(level, false), advanced = opening(level, true);
        assert.ok(advanced.hit.damage > basic.hit.damage);
        assert.ok(advanced.move.cost > basic.move.cost);
    }
});

test('ordinary response safety preserves Power, Guard and Vitality investment direction', () => {
    for (const level of [75, 100]) for (const advanced of [false, true]) {
        const allocation = balanced(level), base = opening(level, advanced);
        // Third-tier points buy 0.25% base each. Ten points can round to the
        // same final compressed hit; twenty still exercises strict direction.
        const power = { ...allocation, vitality: allocation.vitality - 20, power: allocation.power + 20 };
        const guard = { ...allocation, power: allocation.power - 20, guard: allocation.guard + 20 };
        const vitality = { ...allocation, power: allocation.power - 20, vitality: allocation.vitality + 20 };
        for (const candidate of [power, guard, vitality]) assert.deepEqual(sanitizeGrowthAllocation(candidate, level), candidate);
        const powered = opening(level, advanced, power);
        const defended = opening(level, advanced, allocation, guard);
        const durable = opening(level, advanced, allocation, vitality);
        assert.ok(powered.hit.damage > base.hit.damage, 'Power must still raise the high-tail hit');
        assert.ok(defended.hit.damage < base.hit.damage, 'Guard must still reduce the high-tail hit');
        assert.ok(durable.hit.damage / durable.targetBefore.maxHp < base.hit.damage / base.targetBefore.maxHp);
        assert.ok(durable.targetBefore.maxHp - durable.hit.damage > base.targetBefore.maxHp - base.hit.damage);
    }
});
