import assert from 'node:assert/strict';
import { test } from 'node:test';
import { petSignatureMastery } from '../../shared/pet-ability-mastery.js';
import { companionMoveDamage, companionStrikeDamage, sealCompanionFromSave, type CompanionMove } from './companion.js';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';

const move = (mastered: boolean): CompanionMove => ({ name: 'Final Art', kind: 'damage', power: mastered ? 198 : 180,
    cooldown: 3, rounds: 2, signature: true, rulesetVersion: 'progression-v3', ...(mastered ? { signatureMastery: true } : {}) });

test('Final Art damage mastery pays after the summon power cap with equal base stats', () => {
    assert.equal(companionMoveDamage(100, move(false)), 140);
    assert.equal(companionMoveDamage(100, move(true)), 154);
    assert.equal(companionMoveDamage(100, { ...move(true), rulesetVersion: undefined }), 140, 'retained moves keep their original capped damage');
    assert.equal(companionMoveDamage(100, { ...move(true), signature: false }), 140, 'ordinary attacks cannot claim Final Art mastery');
});

test('earned Final Art power does not also increase every ordinary summon strike', () => {
    const pet = (level: number) => ({ id: 'owned-fire', templateId: 'starter-fire', name: 'Pet', level, hp: 700, attack: 80, defense: 60, speed: 50,
        happiness: 100, growthBaseStats: { hp: 500, attack: 60, defense: 50, speed: 40 }, growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 },
        rankedBuild: { ...tacticsPreset('starter-fire'), ownedPetId: 'owned-fire' } });
    const at74 = pet(74), at75 = pet(75);
    assert.equal(companionStrikeDamage(at75) - companionStrikeDamage(at74), 2, 'only ordinary level growth changes the shared strike baseline');
    const oldSeal = sealCompanionFromSave({ pets: [at74], activePetId: at74.id })!;
    const newSeal = sealCompanionFromSave({ pets: [at75], activePetId: at75.id })!;
    const oldSignature = oldSeal.moves.find(ability => ability.signature)!;
    const newSignature = newSeal.moves.find(ability => ability.signature)!;
    assert.equal(newSignature.signatureMastery, true);
    assert.ok(companionMoveDamage(100, newSignature) > companionMoveDamage(100, oldSignature));
});

test('shared final-art support values change only for the earned version', () => {
    assert.deepEqual(petSignatureMastery('signature-mastery', false), petSignatureMastery(undefined));
    const base = petSignatureMastery(undefined), mastery = petSignatureMastery('signature-mastery');
    assert.equal(base.healPct, .175); assert.equal(mastery.healPct, .2);
    assert.equal(base.shieldPct, .225); assert.equal(mastery.shieldPct, .25);
    assert.equal(base.buffMult, 1.25); assert.equal(mastery.buffMult, 1.3);
    assert.equal(mastery.tauntRounds, 2); assert.equal(mastery.cleanseResistRounds, 1);
});
import { createSoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import type { PvpFighter } from '../pvp/session.js';
import { companionActor } from '../towers/_companion.js';
import { createTowerSession, getActor, type TowerActor } from '../towers/_tower-session.js';
import { startRound, runAiUntilHuman } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';

const supportMove = (kind: string, mastered: boolean): CompanionMove => ({ name: 'Final Art', kind, power: mastered ? 110 : 100,
    cooldown: 3, rounds: 2, signature: true, rulesetVersion: 'progression-v3', ...(mastered ? { signatureMastery: true } : {}) });
const fighter = (name: string, pos: number): PvpFighter => ({ name, pos, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500,
    stamina: 500, maxStamina: 500, shield: 0, statuses: [], character: { level: 100, specialty: 'Taijutsu', stats: {} } } as PvpFighter);

for (const kind of ['heal', 'shield', 'buff', 'haste', 'absorb', 'taunt', 'cleanse']) test(`solo executes equal-stat Final Art mastery for ${kind}`, () => {
    const execute = (mastered: boolean) => {
        const session = createSoloPveSession({ sessionId: 'mastery-' + kind, ownerSlug: 'review', encounter: { kind: 'test', id: 'mastery' },
            player: fighter('Owner', 62), enemy: fighter('Enemy', 63), now: 1000,
            companion: { petId: 'pet', name: 'Pet', hp: 1000, damage: 100, happiness: 100, loyal: true, pveGearId: '',
                rulesetVersion: 'progression-v3', moves: [supportMove(kind, mastered)] } });
        const summoned = applySoloPveAction(session, { type: 'summon' }).session;
        summoned.companion!.hp = 200;
        summoned.companion!.ordinaryActions = 2;
        if (kind === 'cleanse') summoned.companion!.statuses = [{ name: 'Decrease Damage Given', rounds: 2, kind: 'negative' }];
        const resolved = applySoloPveAction(summoned, { type: 'wait' }).session;
        const event = resolved.events.find(event => event.actor === 'companion' && event.actionName === 'Final Art');
        assert.ok(event, kind + ' must actually execute');
        return event.after.companion!;
    };
    const base = execute(false), mastery = execute(true);
    if (kind === 'heal') assert.equal(mastery.hp - base.hp, 25);
    else if (kind === 'shield') assert.equal(mastery.shield - base.shield, 25);
    else if (kind === 'cleanse') assert.equal(mastery.statuses.some(status => status.name === 'Stun Prevent'), true);
    else { const name = kind === 'absorb' ? 'Absorb' : kind === 'taunt' ? 'Decrease Damage Taken' : 'Increase Damage Given';
        const a = base.statuses.find(status => status.name === name)!, b = mastery.statuses.find(status => status.name === name)!;
        assert.equal(Number(b.percent) - Number(a.percent), 5);
        if (kind === 'taunt') assert.equal(b.rounds - a.rounds, 1);
    }
});

for (const kind of ['heal', 'shield', 'buff', 'haste', 'absorb', 'taunt', 'cleanse']) test(`tower executes equal-stat Final Art mastery for ${kind}`, () => {
    const execute = (mastered: boolean) => {
        const companion = companionActor({ petId: 'pet', name: 'Pet', hp: 1000, damage: 100, happiness: 100, loyal: true,
            pveGearId: '', rulesetVersion: 'progression-v3', moves: [supportMove(kind, mastered)] }, 1);
        companion.hp = 200; companion.character.companionOrdinaryActions = 2;
        if (kind === 'cleanse') companion.statuses = [{ name: 'Decrease Damage Given', rounds: 2, kind: 'negative' }];
        const actor = (id: string, side: TowerActor['side'], pos: number, ai = true) => ({ id, side, pos, name: id, ai, ownerSlug: ai ? null : 'review',
            hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0, statuses: [], cooldowns: {}, character: { specialty: 'Taijutsu', stats: {} } } as TowerActor);
        const session = createTowerSession({ towerId: 'review', runId: 'mastery', floor: 1, seed: 1, partySize: 1,
            map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
            actors: [actor('sq-1', 'squad', 0, false), companion, actor('en-1', 'enemy', 2)], objectiveKind: 'defeat-all', now: 1000 });
        startRound(session);
        const floor: TowerFloor = { id: 1, name: 'Review', biome: 'forest', objective: 'defeat-all', roundBudget: 8, map: { width: 8, height: 8 }, fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {} };
        runAiUntilHuman(session, floor, () => .9);
        assert.ok(session.log.some(line => line.includes('uses Final Art')), 'must execute its earned signature');
        return getActor(session, 'companion-0')!;
    };
    const base = execute(false), mastery = execute(true);
    if (kind === 'heal') assert.equal(mastery.hp - base.hp, 25);
    else if (kind === 'shield') assert.equal(mastery.shield - base.shield, 25);
    else if (kind === 'cleanse') assert.equal(mastery.statuses.some(status => status.name === 'Stun Prevent'), true);
    else { const name = kind === 'absorb' ? 'Absorb' : kind === 'taunt' ? 'Decrease Damage Taken' : 'Increase Damage Given';
        const a = base.statuses.find(status => status.name === name)!, b = mastery.statuses.find(status => status.name === name)!;
        assert.equal(Number(b.percent) - Number(a.percent), 5);
        if (kind === 'taunt') assert.equal(b.rounds - a.rounds, 1);
    }
});

test('advanced mastery pays after summon power caps and stays confined to its learned cast', () => {
    const base: CompanionMove = { ...move(false), name: 'Advanced Art', signature: false };
    const mastered: CompanionMove = { ...base, power: Math.round(base.power * 1.08), offenseMastery: true };
    assert.equal(companionMoveDamage(100, base), 140);
    assert.equal(companionMoveDamage(100, mastered), 151);
    assert.equal(companionMoveDamage(100, { ...mastered, rulesetVersion: undefined }), 140);
    assert.equal(companionMoveDamage(100, { ...mastered, signature: true }), 140);
});
