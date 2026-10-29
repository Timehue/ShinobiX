import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { companionMoveAp, sealCompanionFromSave, type CompanionSeal, type CompanionMove } from './companion.js';
import { derivePetGrowthStats } from '../pet/_growth.js';
import { createSoloPveSession } from '../solo-pve/_session.js';
import { applySoloPveAction, runSoloPveAiUntilPlayer } from '../solo-pve/_engine.js';
import type { PvpFighter } from '../pvp/session.js';
import { companionActor } from '../towers/_companion.js';
import { createTowerSession, getActor, type TowerActor } from '../towers/_tower-session.js';
import { applyAction, checkTowerWinner, endTurn, humanHasTowerAction, runAiUntilHuman, startRound } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';

const NOW = 1_800_000_000_000;
const move = (power = 30): CompanionMove => ({ name: 'Small Strike', kind: 'damage', power, cooldown: 1, rounds: 2, signature: false });
const seal = (over: Partial<CompanionSeal> = {}): CompanionSeal => ({ petId: 'owned-fire', name: 'Ember', hp: 1000,
    damage: 100, happiness: 100, loyal: false, pveGearId: '', rulesetVersion: 'progression-v3', moves: [move()], ...over });
const fighter = (name: string, pos: number): PvpFighter => ({ name, pos, hp: 10000, maxHp: 10000,
    chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, shield: 0, statuses: [],
    character: { level: 50, specialty: 'Taijutsu', stats: {}, jutsu: [], equipment: {}, pvpItems: [] } });
function solo(companion = seal(), enemyPos = 119) {
    const session = createSoloPveSession({ sessionId: 'companion-audit', ownerSlug: 'owner',
        encounter: { kind: 'test', id: 'audit' }, player: fighter('Owner', 0), enemy: fighter('Enemy', enemyPos),
        companion, now: NOW });
    return applySoloPveAction(session, { type: 'summon' }).session;
}
const floor: TowerFloor = { id: 1, name: 'Audit', biome: 'forest', objective: 'defeat-all', roundBudget: 10,
    map: { width: 12, height: 10 }, fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {} };
function tower(companion = seal(), enemyPos = 119) {
    const actor = (id: string, side: TowerActor['side'], pos: number): TowerActor => ({ ...fighter(id, pos),
        id, side, ai: side === 'enemy', ownerSlug: side === 'squad' ? 'owner' : null, cooldowns: {} });
    const session = createTowerSession({ towerId: 'narrative-group', runId: 'companion-audit', floor: 1, seed: 1,
        partySize: 1, now: NOW, objectiveKind: 'defeat-all', actors: [actor('owner', 'squad', 0),
            companionActor(companion, 1), actor('enemy', 'enemy', enemyPos)],
        map: { width: 12, height: 10, blockedTiles: [], hazardTiles: [], objectiveTiles: [] } });
    startRound(session);
    // Run only the pet, then pause at the human before the opponent acts.
    session.turnQueue = ['companion-0', 'owner', 'enemy']; session.activeIndex = 0; session.activeAp = 100;
    return session;
}

test('solo: low-power offensive moves close distance instead of attacking across the board', () => {
    const session = applySoloPveAction(solo(), { type: 'wait' }).session;
    const actions = session.events.filter(event => event.actor === 'companion' && event.action === 'companionMove');
    assert.ok(actions.length > 0);
    assert.ok(actions.every(event => event.actionName === 'Move'), 'a weak strike is still an offensive move with a range limit');
    assert.equal(session.enemy.hp, session.enemy.maxHp);
});

test('group: low-power offensive moves close distance instead of attacking across the board', () => {
    const session = tower();
    runAiUntilHuman(session, floor, () => .9);
    assert.ok(session.log.some(line => line.includes('closes in')));
    assert.equal(getActor(session, 'enemy')!.hp, 10000);
});

test('the selected owned pet supplies its HP, learned kit, defenses, gear and nickname', () => {
    const pet = { id: 'owned-fire', templateId: 'starter-fire', name: 'Cinder Cub', nickname: 'My Ember', level: 75,
        hp: 970, attack: 180, defense: 140, speed: 100, role: 'sage', happiness: 100,
        happinessDay: Math.floor(NOW / 86_400_000), loadout: { pve: 'pve-frenzy-claw', pveDurability: 10 } };
    const saved = { pets: [{ ...pet, id: 'other', hp: 1 }, pet], activePetId: pet.id };
    const selected = sealCompanionFromSave(saved, NOW)!;
    assert.equal(selected.petId, pet.id);
    assert.equal(selected.name, pet.nickname);
    assert.equal(selected.hp, pet.hp);
    assert.equal(selected.defense, pet.defense);
    assert.equal(selected.spDefense, Math.round(pet.defense * 1.08));
    assert.equal(selected.speed, pet.speed);
    assert.equal(selected.pveGearId, pet.loadout.pve);
    assert.ok(selected.moves.some(ability => ability.signature));
    const battle = solo(selected, 2);
    pet.hp = 1; pet.attack = 1; pet.loadout.pve = '';
    assert.equal(battle.companion!.maxHp, 970, 'changes outside an admitted battle cannot replace its pet snapshot');
    assert.equal(battle.companion!.baseDamage, selected.damage);
    assert.equal(battle.companion!.pveGearId, 'pve-frenzy-claw');
    assert.deepEqual(battle.companion!.moves, selected.moves);
});

function grownPet(allocation: Partial<{ vitality: number; power: number; guard: number; agility: number }> = {}, trait = 'Loyal') {
    const pet = { id: 'owned-fire', templateId: 'starter-fire', name: 'Cinder Cub', level: 75, role: 'sage', trait,
        happiness: 100, happinessDay: Math.floor(NOW / 86_400_000), growthVersion: 2,
        growthBaseStats: { hp: 500, attack: 60, defense: 50, speed: 60 },
        growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0, ...allocation } };
    return { ...pet, ...derivePetGrowthStats(pet) };
}
function ownedSeal(pet = grownPet()) {
    return sealCompanionFromSave({ pets: [pet], activePetId: pet.id }, NOW)!;
}

test('Speed uses a bounded movement discount and retained snapshots keep the old cost', () => {
    assert.equal(companionMoveAp(undefined), 30);
    assert.equal(companionMoveAp(NaN), 30);
    assert.equal(companionMoveAp(-10), 30);
    assert.equal(companionMoveAp(100), 25);
    assert.equal(companionMoveAp(200), 20);
    assert.equal(companionMoveAp(100000), 20);
});

test('actual Agility growth buys movement in both engines without increasing attack damage or lifespan', () => {
    const slow = ownedSeal(grownPet()), fast = ownedSeal(grownPet({ agility: 222 }));
    assert.ok(fast.speed! > slow.speed!);
    assert.equal(fast.damage, slow.damage);
    assert.equal(fast.hp, slow.hp);
    // Isolate movement from species support choices; keep the real sealed stats.
    slow.moves = fast.moves = [move(45)];
    const steps = (companion: CompanionSeal) => {
        const result = applySoloPveAction(solo(companion), { type: 'wait' }).session;
        assert.equal(result.companion!.roundsLeft, 3);
        assert.equal(result.companion!.ordinaryActions, 0, 'movement cannot charge Final Art');
        return result.events.filter(event => event.actor === 'companion' && event.actionName === 'Move').length;
    };
    assert.ok(steps(fast) > steps(slow));
    const groupSteps = (companion: CompanionSeal) => {
        const result = tower(companion);
        runAiUntilHuman(result, floor, () => .9);
        assert.equal(getActor(result, 'companion-0')!.character.companionOrdinaryActions, 0);
        return result.log.filter(line => line.includes('closes in')).length;
    };
    assert.ok(groupSteps(fast) > groupSteps(slow));
    assert.ok(groupSteps(fast) <= 5, 'the existing action limit still applies');
});

test('Power growth increases real companion hits in solo and group combat', () => {
    const base = ownedSeal(), strong = ownedSeal(grownPet({ power: 100 }));
    const soloHit = (companion: CompanionSeal) => {
        const result = applySoloPveAction(solo({ ...companion, moves: [move(45)] }, 2), { type: 'wait' }).session;
        const hit = result.events.find(event => event.actor === 'companion' && event.target === 'enemy');
        assert.ok(hit);
        return hit.before.enemy.hp - hit.after.enemy.hp;
    };
    const groupHit = (companion: CompanionSeal) => {
        const result = tower({ ...companion, moves: [move(45)] }, 2);
        runAiUntilHuman(result, floor, () => .9);
        return 10000 - getActor(result, 'enemy')!.hp;
    };
    assert.ok(soloHit(strong) > soloHit(base));
    assert.ok(groupHit(strong) > groupHit(base));
});

test('Vitality, Guard and stat traits survive admission into both runtime actors', () => {
    const base = ownedSeal(), vital = ownedSeal(grownPet({ vitality: 100 })), guarded = ownedSeal(grownPet({ guard: 100 }));
    assert.ok(solo(vital).companion!.maxHp > solo(base).companion!.maxHp);
    assert.equal(vital.referenceHp, base.referenceHp, 'more HP does not inflate solo enemy counterattack damage');
    assert.ok(solo(guarded).companion!.defense! > solo(base).companion!.defense!);
    const groupGuard = getActor(tower(guarded), 'companion-0')!;
    const defenses = groupGuard.character.stats as Record<string, number>;
    assert.equal(defenses.taijutsuDefense, guarded.defense);
    assert.equal(defenses.ninjutsuDefense, guarded.spDefense);
    assert.ok(getActor(tower(vital), 'companion-0')!.maxHp > getActor(tower(base), 'companion-0')!.maxHp);
    assert.ok(ownedSeal(grownPet({}, 'Aggressive')).damage > base.damage);
    assert.ok(ownedSeal(grownPet({}, 'Guardian')).hp > base.hp);
    assert.ok(ownedSeal(grownPet({}, 'Guardian')).defense! > base.defense!);
    assert.ok(ownedSeal(grownPet({}, 'Swift')).speed! > base.speed!);
});

test('solo summon costs 20 AP, remains single-use and expires after four actual phases', () => {
    let session = solo(seal({ hp: 100000, moves: [move(45)] }));
    assert.equal(session.ap.player, 80);
    assert.equal(session.actionsThisTurn, 0);
    assert.equal(applySoloPveAction(session, { type: 'summon' }).applied, false);
    for (let phase = 1; phase <= 4; phase++) {
        session = applySoloPveAction(session, { type: 'wait' }).session;
        assert.equal(session.companion?.roundsLeft, phase < 4 ? 4 - phase : undefined);
    }
    assert.equal(applySoloPveAction(session, { type: 'summon' }).applied, false);
    assert.deepEqual(session.companionUsage, { petId: 'owned-fire' });
});

for (const professionRank of [9, 10]) test(`rank-${professionRank} Tamer summon pricing is sealed and enforced in both engines`, () => {
    const pet = grownPet();
    const companion = sealCompanionFromSave({ pets: [pet], activePetId: pet.id, profession: 'petTamer', professionRank }, NOW)!;
    const expected = professionRank === 10 ? 0 : 20;
    assert.equal(companion.summonApCost, expected);
    const session = createSoloPveSession({ sessionId: 'priced-summon', ownerSlug: 'owner', encounter: { kind: 'test', id: 'price' },
        player: fighter('Owner', 0), enemy: fighter('Enemy', 119), companion, now: NOW });
    const summoned = applySoloPveAction(session, { type: 'summon' });
    assert.equal(summoned.applied, true);
    assert.equal(summoned.session.ap.player, 100 - expected);
    const retry = applySoloPveAction(summoned.session, { type: 'summon' });
    assert.equal(retry.applied, false);
    assert.equal(retry.session.ap.player, 100 - expected);

    session.ap.player = expected === 0 ? 0 : 19;
    const scarce = applySoloPveAction(session, { type: 'summon' });
    assert.equal(scarce.applied, expected === 0);
    if (expected > 0) {
        assert.equal(scarce.reason, 'insufficient-ap');
        assert.deepEqual(scarce.session, session, 'a refused summon must not heal, spend the seal or change AP');
    }

    const group = tower();
    group.actors = group.actors.filter(actor => actor.id !== 'companion-0');
    group.turnQueue = ['owner', 'enemy']; group.activeIndex = 0; group.activeAp = expected === 0 ? 0 : 19;
    group.pendingCompanion = companion;
    const owner = getActor(group, 'owner')!;
    assert.equal(humanHasTowerAction(group, owner), expected === 0, 'only an affordable summon keeps the turn open');
    const before = structuredClone(group);
    const refused = applyAction(group, floor, { type: 'summon', actorId: 'owner' }, () => .9);
    assert.equal(refused.applied, expected === 0);
    if (expected > 0) {
        assert.deepEqual(group, before);
        group.activeAp = 20;
        assert.equal(humanHasTowerAction(group, owner), true);
        assert.equal(applyAction(group, floor, { type: 'summon', actorId: 'owner' }, () => .9).applied, true);
    }
    assert.equal(group.activeAp, 0);
    assert.equal(group.actionsThisTurn, 0, 'summoning retains its existing once-per-fight action-slot exemption');
    assert.equal(applyAction(group, floor, { type: 'summon', actorId: 'owner' }, () => .9).applied, false);
    assert.equal(group.activeAp, 0);
});

test('only a free pending summon holds the solo turn open after spending the last AP', () => {
    for (const summonApCost of [20, 0]) {
        const session = createSoloPveSession({ sessionId: 'summon-turn-end', ownerSlug: 'owner',
            encounter: { kind: 'test', id: 'price' }, player: fighter('Owner', 0), enemy: fighter('Enemy', 119),
            companion: seal({ summonApCost }), now: NOW });
        session.ap.player = 30;
        const result = applySoloPveAction(session, { type: 'move', tile: 1 });
        assert.equal(result.applied, true);
        assert.equal(result.session.round, session.round + (summonApCost === 0 ? 0 : 1));
        if (summonApCost === 0) assert.equal(result.session.ap.player, 0);
    }
});

test('a blocked summon placement never spends AP or consumes the pending pet', () => {
    const session = createSoloPveSession({ sessionId: 'summon-no-space', ownerSlug: 'owner',
        encounter: { kind: 'test', id: 'price' }, player: fighter('Owner', 0), enemy: fighter('Enemy', 119),
        companion: seal({ summonApCost: 20 }), now: NOW });
    session.environment.blockedTiles = Array.from({ length: 118 }, (_, i) => i + 1);
    const result = applySoloPveAction(session, { type: 'summon' });
    assert.equal(result.reason, 'no-space');
    assert.deepEqual(result.session, session);

    const group = tower();
    group.actors = group.actors.filter(actor => actor.id !== 'companion-0');
    group.turnQueue = ['owner', 'enemy']; group.activeIndex = 0;
    group.pendingCompanion = seal({ summonApCost: 20 });
    group.map.blockedTiles = session.environment.blockedTiles;
    const before = structuredClone(group);
    assert.equal(applyAction(group, floor, { type: 'summon', actorId: 'owner' }, () => .9).reason, 'no-space');
    assert.deepEqual(group, before);
});

test('Pet Tamer rank and combat mastery are sealed into real summon HP and damage', () => {
    const pet = grownPet();
    const base = ownedSeal(pet);
    const master = sealCompanionFromSave({ pets: [pet], activePetId: pet.id, profession: 'petTamer', professionRank: 10,
        masterySpec: { 'pet-damage': 2, 'pet-hp': 2, 'alpha-bond': 1 } }, NOW)!;
    assert.equal(master.hp, Math.round(base.hp * 1.08));
    assert.equal(master.damage, Math.floor(base.damage * 1.24));
    assert.equal(master.referenceHp, base.referenceHp, 'Toughened Hide must not inflate incoming counterattack damage');
    assert.equal(master.reviveOnce, true);
    const foreign = sealCompanionFromSave({ pets: [pet], activePetId: pet.id, profession: 'healer', professionRank: 10,
        masterySpec: { 'pet-damage': 2, 'pet-hp': 2, 'alpha-bond': 1 } }, NOW)!;
    assert.equal(foreign.damage, base.damage);
    assert.equal(foreign.hp, base.hp);
    assert.equal(foreign.reviveOnce, undefined);
    const soloHit = (companion: CompanionSeal) => {
        const admitted = solo({ ...companion, moves: [move(45)] }, 2);
        const result = applySoloPveAction(admitted, { type: 'wait' }).session;
        return result.events.find(event => event.actor === 'companion' && event.target === 'enemy')!;
    };
    const baseHit = soloHit(base), masterHit = soloHit(master);
    assert.ok(masterHit.before.enemy.hp - masterHit.after.enemy.hp > baseHit.before.enemy.hp - baseHit.after.enemy.hp);
    const groupHit = (companion: CompanionSeal) => {
        const result = tower({ ...companion, moves: [move(45)] }, 2);
        runAiUntilHuman(result, floor, () => .9);
        return getActor(result, 'enemy')!.hp;
    };
    assert.ok(groupHit(master) < groupHit(base));
});

test('solo Alpha Bond survives a real lethal hit once and retains the remaining duration', () => {
    const session = solo(seal({ reviveOnce: true }), 2);
    const hit = () => {
        session.companion!.hp = 1;
        session.activeSide = 'enemy'; session.ap.enemy = 40; session.actionsThisTurn = 0;
        session.eventSeq |= 1; // wounded-companion targeting is deterministic on an odd sequence.
        runSoloPveAiUntilPlayer(session);
    };
    hit();
    assert.equal(session.companion?.hp, 400);
    assert.equal(session.companion?.reviveAvailable, false);
    assert.equal(session.companion?.roundsLeft, 4);
    assert.ok(session.events.some(event => event.target === 'companion' && event.after.companion?.hp === 400));
    hit();
    assert.equal(session.companion, undefined);
    assert.equal(session.log.filter(line => line.includes('revives through Alpha Bond')).length, 1);
});

test('solo Alpha Bond handles lethal ongoing damage and cannot renew after serialization', () => {
    let session = solo(seal({ reviveOnce: true }));
    session.companion!.statuses = [{ name: 'Wound', amount: 10000, rounds: 3, kind: 'negative' }];
    session = applySoloPveAction(session, { type: 'wait' }).session;
    assert.equal(session.companion?.hp, 400);
    assert.equal(session.companion?.roundsLeft, 3);
    assert.equal(session.companion?.reviveAvailable, false);
    session = applySoloPveAction(JSON.parse(JSON.stringify(session)), { type: 'wait' }).session;
    assert.equal(session.companion, undefined);
    assert.equal(session.log.filter(line => line.includes('revives through Alpha Bond')).length, 1);
});

test('group Alpha Bond handles real attacks and round damage once without postponing expiry', () => {
    const session = tower(seal({ reviveOnce: true }), 2);
    const pet = getActor(session, 'companion-0')!;
    session.turnQueue = ['enemy', 'owner', pet.id]; session.activeIndex = 0;
    pet.hp = 1;
    assert.equal(applyAction(session, floor, { type: 'attack', actorId: 'enemy', targetId: pet.id }, () => .9).applied, true);
    assert.equal(pet.hp, 400);
    assert.equal(pet.character.companionReviveAvailable, false);
    pet.hp = 1;
    assert.equal(applyAction(session, floor, { type: 'attack', actorId: 'enemy', targetId: pet.id }, () => .9).applied, true);
    assert.equal(pet.hp, 0);
    const ongoing = tower(seal({ reviveOnce: true }));
    const wounded = getActor(ongoing, 'companion-0')!;
    wounded.statuses = [{ name: 'Wound', amount: 10000, rounds: 3, kind: 'negative' }];
    ongoing.activeIndex = ongoing.turnQueue.length - 1;
    endTurn(ongoing, floor);
    assert.equal(wounded.hp, 400);
    assert.equal(wounded.character.companionReviveAvailable, false);
    const expiring = tower(seal({ reviveOnce: true }));
    getActor(expiring, 'companion-0')!.character.companionRoundsLeft = 1;
    startRound(expiring);
    checkTowerWinner(expiring, floor);
    assert.equal(getActor(expiring, 'companion-0'), undefined);
    assert.ok(!expiring.log.some(line => line.includes('revives through Alpha Bond')));
});

test('Alpha Bond reserves the pet tile before an area hit displaces another actor', () => {
    const session = tower(seal({ reviveOnce: true }));
    const owner = getActor(session, 'owner')!, pet = getActor(session, 'companion-0')!, enemy = getActor(session, 'enemy')!;
    enemy.pos = 13; owner.pos = 14; pet.pos = 15; pet.hp = 1;
    enemy.character.stats = { taijutsuOffense: 2500 };
    session.map.blockedTiles = Array.from({ length: 120 }, (_, i) => i).filter(tile => ![13, 14, 15].includes(tile));
    enemy.character.jutsu = [{ id: 'audit-push', name: 'Shockwave', type: 'Taijutsu', element: 'None',
        target: 'OPPONENT', method: 'AOE_BURST', effectPower: 30, isUtility: false, ap: 40, range: 3,
        chakraCost: 0, staminaCost: 0, tags: [{ name: 'Push' }] }];
    session.turnQueue = ['enemy', 'owner', pet.id]; session.activeIndex = 0;
    const result = applyAction(session, floor, { type: 'jutsu', actorId: 'enemy', jutsuId: 'audit-push', targetId: 'owner' }, () => .9);
    assert.equal(result.applied, true, result.reason ?? 'area hit accepted');
    assert.equal(pet.character.companionReviveAvailable, false, JSON.stringify({ hp: pet.hp, log: session.log }));
    assert.ok(pet.hp > 0);
    assert.notEqual(owner.pos, pet.pos, 'a revived pet must keep its tile occupied during knockback');
});
