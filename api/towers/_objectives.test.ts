import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { TowerFloor } from './_floor-catalog.js';
import {
    applyAction,
    checkTowerWinner,
    endTurn,
    pickAiAction,
    startRound,
    type TowerAction,
} from './_engine.js';
import { makeRng } from './_sim.js';
import {
    createTowerSession,
    getActor,
    type TowerActor,
    type TowerMap,
    type TowerSession,
} from './_tower-session.js';

const BASE_MAP: TowerMap = {
    width: 8,
    height: 8,
    blockedTiles: [],
    hazardTiles: [],
    objectiveTiles: [],
};

const STRONG = {
    specialty: 'Taijutsu',
    level: 100,
    stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 },
};
const WEAK = {
    specialty: 'Taijutsu',
    level: 100,
    stats: { taijutsuOffense: 200, taijutsuDefense: 200 },
};
const ARMORED = {
    specialty: 'Taijutsu',
    level: 100,
    stats: { taijutsuOffense: 200, taijutsuDefense: 2500 },
};

function actor(id: string, side: TowerActor['side'], pos: number, over: Partial<TowerActor> = {}): TowerActor {
    return {
        id,
        side,
        name: id,
        ownerSlug: null,
        ai: true,
        hp: 1000,
        maxHp: 1000,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos,
        character: WEAK,
        ...over,
    };
}

function floor(objective: TowerFloor['objective'], over: Partial<TowerFloor> = {}): TowerFloor {
    return {
        id: 91,
        name: 'Objective Test',
        biome: 'forest',
        objective,
        roundBudget: 8,
        map: { width: 8, height: 8 },
        fieldRule: { kind: 'none' },
        enemies: [],
        firstClearReward: {},
        ...over,
    };
}

function session(
    objective: TowerFloor['objective'],
    actors: TowerActor[],
    over: Partial<Parameters<typeof createTowerSession>[0]> = {},
): TowerSession {
    return createTowerSession({
        towerId: 'objective-test',
        runId: 'run-1',
        floor: 91,
        seed: 410,
        partySize: 1,
        map: BASE_MAP,
        actors,
        objectiveKind: objective,
        bossId: 'boss',
        now: 1_000,
        ...over,
    });
}

function player(over: Partial<TowerActor> = {}): TowerActor {
    return actor('player', 'squad', 28, { ai: false, character: STRONG, ...over });
}

function boss(over: Partial<TowerActor> = {}): TowerActor {
    return actor('boss', 'enemy', 29, { character: WEAK, ...over });
}

function add(id = 'add', over: Partial<TowerActor> = {}): TowerActor {
    return actor(id, 'enemy', 36, { hp: 1, maxHp: 1, character: WEAK, ...over });
}

function act(s: TowerSession, f: TowerFloor, action: TowerAction) {
    return applyAction(s, f, action, makeRng(9));
}

describe('Battle Tower gated objectives', () => {
    for (const objective of ['defeat-all-then-boss', 'kill-adds-first'] as const) {
        it(`${objective}: rejects explicit boss damage without spending combat resources`, () => {
            const p = player({
                itemCharges: { kunai: 1 },
                character: {
                    ...STRONG,
                    jutsu: [{
                        id: 'costly-hit', name: 'Costly Hit', type: 'Taijutsu', effectPower: 25,
                        ap: 40, range: 1, chakraCost: 15, staminaCost: 7, cooldown: 3,
                    }],
                    pvpItems: [{
                        id: 'kunai', name: 'Kunai', slot: 'thrown', weaponEp: 20,
                        weaponRange: 4, apCost: 40, weaponCooldown: 5,
                    }],
                    equipment: { thrown: 'kunai' },
                },
            });
            const s = session(objective, [p, boss(), add()]);
            const f = floor(objective);
            startRound(s);
            const before = {
                hp: getActor(s, 'boss')!.hp,
                ap: s.activeAp,
                chakra: p.chakra,
                stamina: p.stamina,
                charges: p.itemCharges!.kunai,
            };

            assert.deepEqual(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }), {
                applied: false,
                reason: 'objective-locked',
            });
            assert.deepEqual(act(s, f, { actorId: p.id, type: 'jutsu', jutsuId: 'costly-hit', targetId: 'boss' }), {
                applied: false,
                reason: 'objective-locked',
            });
            assert.deepEqual(act(s, f, { actorId: p.id, type: 'weapon', itemId: 'kunai', targetId: 'boss' }), {
                applied: false,
                reason: 'objective-locked',
            });

            assert.equal(getActor(s, 'boss')!.hp, before.hp);
            assert.equal(s.activeAp, before.ap);
            assert.equal(p.chakra, before.chakra);
            assert.equal(p.stamina, before.stamina);
            assert.equal(p.itemCharges!.kunai, before.charges);
            assert.deepEqual(p.cooldowns, {});
            assert.equal(s.objectiveState.addsRemaining, 1);
            assert.equal(s.objectiveState.bossUnlocked, false);
            assert.ok(s.log.some(line => line.includes('cannot target boss')));
        });
    }

    it('unlocks visibly after the last live add dies and permits a later boss hit', () => {
        const p = player();
        const s = session('defeat-all-then-boss', [p, boss(), add()]);
        const f = floor('defeat-all-then-boss');
        startRound(s);

        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'add' }).applied, true);
        assert.equal(getActor(s, 'add')!.hp, 0);
        assert.equal(s.objectiveState.addsRemaining, 0);
        assert.equal(s.objectiveState.bossUnlocked, true);
        assert.ok(s.log.some(line => line.includes('Objective unlocked: all reinforcements are defeated')));

        const before = getActor(s, 'boss')!.hp;
        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }).applied, true);
        assert.ok(getActor(s, 'boss')!.hp < before);
    });

    it('counts sealed pending waves before deployment, then unlocks only after the deployed unit dies', () => {
        const p = player();
        const s = session('kill-adds-first', [p, boss()]);
        s.pendingEnemyWaves = [{ round: 2, actors: [add('wave-add')] }];
        const f = floor('kill-adds-first');

        startRound(s);
        assert.equal(s.objectiveState.addsRemaining, 1);
        assert.equal(s.objectiveState.bossUnlocked, false);
        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }).reason, 'objective-locked');

        s.round = 2;
        startRound(s);
        assert.equal(s.pendingEnemyWaves, undefined);
        assert.equal(getActor(s, 'wave-add')?.hp, 1);
        assert.equal(s.objectiveState.bossUnlocked, false);
        assert.ok(s.log.some(line => line.includes('reinforcement enter the battlefield')));

        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'wave-add' }).applied, true);
        assert.equal(s.objectiveState.addsRemaining, 0);
        assert.equal(s.objectiveState.bossUnlocked, true);
    });

    it('retains a due wave when no entry tile is legal instead of unlocking the boss', () => {
        const p = player();
        const enemyHalf = Array.from({ length: 64 }, (_, tile) => tile).filter(tile => (tile % 8) >= 4);
        const s = session('kill-adds-first', [p, boss()], {
            map: { ...BASE_MAP, blockedTiles: enemyHalf },
        });
        s.pendingEnemyWaves = [{ round: 2, actors: [add('sealed-wave-add')] }];
        const f = floor('kill-adds-first');
        s.round = 2;
        startRound(s);

        assert.equal(s.pendingEnemyWaves?.[0]?.actors[0]?.id, 'sealed-wave-add', 'undeployed content remains sealed');
        assert.equal(s.objectiveState.addsRemaining, 1);
        assert.equal(s.objectiveState.bossUnlocked, false);
        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }).reason, 'objective-locked');
        assert.ok(s.log.some(line => line.includes('await a clear entry tile')));
    });

    it('a phase summon immediately restores the barrier until the summoned add dies', () => {
        const p = player();
        const summoner = boss({
            hp: 900,
            maxHp: 1000,
            character: {
                ...WEAK,
                mechanic: 'summon',
                summonCount: 1,
                summonTemplate: { name: 'Phase Add', hp: 1, stats: WEAK.stats },
            },
        });
        const summonMap: TowerMap = { ...BASE_MAP, blockedTiles: [21, 30, 38] };
        const s = session('kill-adds-first', [p, summoner], { map: summonMap, bossPhases: [90] });
        const f = floor('kill-adds-first');
        startRound(s);
        assert.equal(s.objectiveState.bossUnlocked, true);

        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }).applied, true);
        const spawned = getActor(s, 'add-0');
        assert.ok(spawned && spawned.hp > 0);
        assert.equal(spawned.pos, 36, 'sealed board geometry makes the summon deterministic');
        assert.equal(s.objectiveState.addsRemaining, 1);
        assert.equal(s.objectiveState.bossUnlocked, false);
        assert.ok(s.log.some(line => line.includes('Objective barrier restored')));

        const protectedHp = getActor(s, 'boss')!.hp;
        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }).reason, 'objective-locked');
        assert.equal(getActor(s, 'boss')!.hp, protectedHp);

        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'add-0' }).applied, true);
        assert.equal(s.objectiveState.addsRemaining, 0);
        assert.equal(s.objectiveState.bossUnlocked, true);
    });

    it('snapshots the barrier for an AOE cast that kills the final add', () => {
        const p = player({
            character: {
                ...STRONG,
                jutsu: [{
                    id: 'burst', name: 'Burst', type: 'Taijutsu', effectPower: 40,
                    ap: 60, range: 1, method: 'AOE_BURST', target: 'OPPONENT',
                }],
            },
        });
        const s = session('kill-adds-first', [p, boss(), add()]);
        const f = floor('kill-adds-first');
        startRound(s);
        const bossHp = getActor(s, 'boss')!.hp;

        assert.equal(act(s, f, { actorId: p.id, type: 'jutsu', jutsuId: 'burst', targetId: 'add' }).applied, true);
        assert.equal(getActor(s, 'add')!.hp, 0);
        assert.equal(getActor(s, 'boss')!.hp, bossHp, 'the boss cannot be a splash victim in the same cast');
        assert.equal(s.objectiveState.bossUnlocked, true);

        assert.equal(act(s, f, { actorId: p.id, type: 'attack', targetId: 'boss' }).applied, true);
        assert.ok(getActor(s, 'boss')!.hp < bossHp, 'the next action observes the unlock');
    });

    it('blocks pre-existing DoT and neutral board chip while the boss is gated', () => {
        const p = player();
        const protectedBoss = boss({
            statuses: [{ name: 'Poison', rounds: 3, percent: 50, kind: 'negative', activeRound: 1 }],
        });
        const hazardMap: TowerMap = {
            ...BASE_MAP,
            features: [{ kind: 'hazard', tiles: [29], percent: 25, label: 'Test Fire' }],
            dynamicHazards: [{ kind: 'geyser', tiles: [29], pct: 25, everyRounds: 1, firstRound: 1 }],
        };
        const s = session('defeat-all-then-boss', [p, protectedBoss, add()], { map: hazardMap });
        const f = floor('defeat-all-then-boss');
        startRound(s);
        const before = protectedBoss.hp;

        s.activeIndex = s.turnQueue.length - 1;
        endTurn(s, f);

        assert.equal(protectedBoss.hp, before);
        assert.equal(s.objectiveState.bossUnlocked, false);
        assert.ok(!s.log.some(line => line.includes('boss takes') || line.includes('boss is scalded')));
    });

    it('squad AI ignores a nearer locked boss and attacks an available add', () => {
        const aiPlayer = player({ ai: true });
        const s = session('kill-adds-first', [aiPlayer, boss(), add('z-add', { hp: 100, maxHp: 100 })]);
        startRound(s);
        const action = pickAiAction(s, aiPlayer, makeRng(3));
        assert.equal(action.type, 'attack');
        if (action.type === 'attack') assert.equal(action.targetId, 'z-add');
    });
});

describe('Battle Tower break-objective', () => {
    function resolveStagedBreak(): TowerSession {
        const p = player({ character: ARMORED });
        const target = boss({ character: ARMORED });
        const s = session('break-objective', [p, target], { bossPhases: [75, 50, 25] });
        const f = floor('break-objective');
        startRound(s);
        assert.deepEqual(
            { done: s.objectiveState.breakStagesCompleted, total: s.objectiveState.breakStagesTotal },
            { done: 0, total: 3 },
        );

        for (const [hp, expected] of [[751, 1], [501, 2], [251, 3]] as const) {
            target.hp = hp;
            s.activeAp = 100;
            s.actionsThisTurn = 0;
            const result = act(s, f, { actorId: p.id, type: 'attack', targetId: target.id });
            assert.equal(result.applied, true);
            assert.equal(s.objectiveState.breakStagesCompleted, expected);
            assert.equal(s.objectiveState.breakStagesTotal, 3);
        }
        return s;
    }

    it('advances only at configured boss HP gates and clears on the final stage without requiring a wipe', () => {
        const s = resolveStagedBreak();
        assert.deepEqual(s.phaseState.triggeredPhases, [75, 50, 25]);
        assert.deepEqual(s.phaseState.pendingPhases, []);
        assert.equal(s.status, 'done');
        assert.equal(s.winner, 'squad');
        assert.equal(s.objectiveState.completed, true);
        assert.ok(getActor(s, 'boss')!.hp > 0, 'the staged objective, not enemy wipe, resolved the floor');
        assert.equal(s.log.filter(line => line.includes('Break objective progress:')).length, 3);
    });

    it('resolves byte-identically from the same sealed phase gates and actions', () => {
        const a = resolveStagedBreak();
        const b = resolveStagedBreak();
        assert.equal(JSON.stringify(a), JSON.stringify(b));
    });

    it('recognizes configured gates crossed by deterministic round-end damage', () => {
        const p = player();
        const target = boss();
        const hazardMap: TowerMap = {
            ...BASE_MAP,
            features: [{ kind: 'hazard', tiles: [29], percent: 80, label: 'Breaker Vent' }],
        };
        const s = session('break-objective', [p, target], { map: hazardMap, bossPhases: [75, 50, 25] });
        const f = floor('break-objective');
        startRound(s);
        s.activeIndex = s.turnQueue.length - 1;

        endTurn(s, f);

        assert.equal(target.hp, 200);
        assert.deepEqual(s.phaseState.triggeredPhases, [75, 50, 25]);
        assert.equal(s.objectiveState.breakStagesCompleted, 3);
        assert.equal(s.winner, 'squad');
    });

    it('does not silently degrade to a defeat-all clear when no phase gates are configured', () => {
        const p = player();
        const deadBoss = boss({ hp: 0 });
        const s = session('break-objective', [p, deadBoss], { bossPhases: [] });
        const f = floor('break-objective');
        startRound(s);
        checkTowerWinner(s, f);

        assert.equal(s.status, 'active');
        assert.equal(s.winner, null);
        assert.equal(s.objectiveState.completed, false);
        assert.equal(s.objectiveState.breakStagesTotal, 0);
        assert.ok(s.log.some(line => line.includes('no boss phase gates are configured')));
    });
});
