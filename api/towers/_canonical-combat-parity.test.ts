import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { v2PoisonOnSpend } from '../_combat-resources.js';
import { towerActorToPvpFighter } from '../combat-adapters/clanBossAdapter.js';
import { adjustedApCost } from '../combat-core/resources.js';
import { applyJutsu as applyPvpJutsu } from '../pvp/move.js';
import { filledDiskTiles } from '../pvp/_aoe.js';
import { CANONICAL_TAG_NAMES, canonicalTagName } from '../pvp/_tags.js';
import type { PvpFighter } from '../pvp/session.js';
import type { TowerFloor } from './_floor-catalog.js';
import { getEnemyTemplate } from './_enemy-templates.js';
import { applyAction, endTurn, pickAiAction, startRound, type TowerAction } from './_engine.js';
import { makeRng } from './_sim.js';
import {
    createTowerSession,
    getActor,
    type TowerActor,
    type TowerMap,
    type TowerSession,
} from './_tower-session.js';

const MAP: TowerMap = {
    width: 8,
    height: 8,
    blockedTiles: [],
    hazardTiles: [],
    objectiveTiles: [],
    biome: 'central',
};

function actor(id: string, side: TowerActor['side'], pos: number, over: Partial<TowerActor> = {}): TowerActor {
    return {
        id,
        side,
        name: id,
        ownerSlug: null,
        ai: side !== 'squad',
        hp: 100_000,
        maxHp: 100_000,
        chakra: 500,
        maxChakra: 500,
        stamina: 500,
        maxStamina: 500,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos,
        character: {
            specialty: 'Ninjutsu',
            level: 100,
            stats: { ninjutsuOffense: 2_500, ninjutsuDefense: 500 },
        },
        ...over,
    };
}

function floor(): TowerFloor {
    return {
        id: 88,
        name: 'Canonical Tower parity',
        biome: 'central',
        objective: 'defeat-all',
        roundBudget: 10,
        map: { width: 8, height: 8 },
        fieldRule: { kind: 'none' },
        enemies: [],
        firstClearReward: {},
    };
}

function session(actors: TowerActor[], map: TowerMap = MAP): TowerSession {
    return createTowerSession({
        towerId: 'canonical-parity',
        runId: 'canonical-parity-run',
        floor: 88,
        seed: 88,
        partySize: actors.filter(entry => entry.side === 'squad').length,
        map: structuredClone(map),
        actors,
        objectiveKind: 'defeat-all',
        now: 1_000,
    });
}

function fighterReceipt(fighter: PvpFighter) {
    return {
        hp: fighter.hp,
        chakra: fighter.chakra,
        stamina: fighter.stamina,
        shield: fighter.shield,
        statuses: fighter.statuses,
        pos: fighter.pos,
    };
}

function towerReceipt(entry: TowerActor) {
    return fighterReceipt(towerActorToPvpFighter(entry));
}

function begin(entries: TowerActor[], map: TowerMap = MAP): TowerSession {
    const out = session(entries, map);
    startRound(out);
    return out;
}

describe('Tower direct-cast canonical tag parity', () => {
    const positional = new Set(['Barrier', 'Push', 'Pull', 'Move']);
    const nonPositionalTags = CANONICAL_TAG_NAMES.filter(name => !positional.has(name));

    it('matches applyPvpJutsu for every non-positional canonical tag', () => {
        const covered: string[] = [];
        for (const tag of nonPositionalTags) {
            const jutsu = {
                id: `parity-${tag.toLowerCase().replaceAll(' ', '-')}`,
                name: `Parity ${tag}`,
                type: 'Ninjutsu',
                element: 'None',
                target: 'OPPONENT',
                method: 'SINGLE',
                effectPower: 40,
                ap: 60,
                range: 5,
                chakraCost: 0,
                staminaCost: 0,
                cooldown: 0,
                tags: [{ name: tag, percent: 20 }],
            };
            const caster = actor('caster', 'squad', 0, {
                ai: false,
                hp: 80_000,
                statuses: [{ name: 'Wound', rounds: 2, amount: 9, kind: 'negative' }],
                character: {
                    specialty: 'Ninjutsu',
                    level: 100,
                    stats: { ninjutsuOffense: 2_500 },
                    jutsu: [jutsu],
                    jutsuMastery: [{ jutsuId: jutsu.id, level: 50 }],
                },
            });
            const target = actor('target', 'enemy', 8, {
                statuses: [{ name: 'Increase Damage Given', rounds: 2, percent: 10, kind: 'positive' }],
                character: {
                    specialty: 'Ninjutsu',
                    level: 100,
                    stats: { ninjutsuDefense: 500 },
                },
            });
            const reference = applyPvpJutsu(
                towerActorToPvpFighter(caster),
                towerActorToPvpFighter(target),
                jutsu,
                1,
                'central',
                1,
            );
            const s = begin([caster, target]);
            const result = applyAction(s, floor(), {
                actorId: caster.id,
                type: 'jutsu',
                jutsuId: jutsu.id,
                targetId: target.id,
            }, makeRng(1));

            assert.equal(result.applied, true, tag);
            assert.deepEqual(towerReceipt(getActor(s, caster.id)!), fighterReceipt(reference.self), `${tag}: caster`);
            assert.deepEqual(towerReceipt(getActor(s, target.id)!), fighterReceipt(reference.opponent), `${tag}: target`);
            assert.deepEqual(s.log.slice(1), reference.lines, `${tag}: shared receipt lines`);
            assert.equal(s.activeAp, 40, `${tag}: neutral 60 AP shell`);
            covered.push(tag);
        }

        assert.deepEqual(covered, nonPositionalTags);
        assert.equal(covered.length, CANONICAL_TAG_NAMES.length - positional.size);
    });

    it('classifies stale zero-damage utility records exactly like canonical PvP targeting', () => {
        const cases: Array<{
            name: string;
            jutsu: Parameters<typeof applyPvpJutsu>[2];
            action: TowerAction;
            self: boolean;
        }> = [
            {
                name: 'legacy OPPONENT self buff',
                jutsu: {
                    id: 'legacy-guard', name: 'Legacy Guard', type: 'Ninjutsu', target: 'OPPONENT',
                    method: 'SINGLE', effectPower: 0, ap: 40, range: 1,
                    chakraCost: 20, staminaCost: 10, cooldown: 3,
                    tags: [{ name: 'Shield', percent: 20 }, { name: 'Increase Damage Given', percent: 15 }],
                },
                action: { actorId: 'caster', type: 'jutsu', jutsuId: 'legacy-guard' } as TowerAction,
                self: true,
            },
            {
                name: 'missing-target self buff',
                jutsu: {
                    id: 'legacy-reflect', name: 'Legacy Reflect', type: 'Genjutsu',
                    method: 'SINGLE', effectPower: 0, ap: 40, range: 0,
                    chakraCost: 5, staminaCost: 0, cooldown: 2,
                    tags: [{ name: 'Reflect', percent: 20 }],
                },
                action: { actorId: 'caster', type: 'jutsu', jutsuId: 'legacy-reflect' } as TowerAction,
                self: true,
            },
            {
                name: 'mixed buff and opponent debuff',
                jutsu: {
                    id: 'mixed-control', name: 'Mixed Control', type: 'Genjutsu', target: 'OPPONENT',
                    method: 'SINGLE', effectPower: 0, ap: 40, range: 5,
                    chakraCost: 0, staminaCost: 0, cooldown: 0,
                    tags: [{ name: 'Absorb', percent: 20 }, { name: 'Decrease Damage Given', percent: 15 }],
                },
                action: { actorId: 'caster', type: 'jutsu', jutsuId: 'mixed-control', targetId: 'target' } as TowerAction,
                self: false,
            },
        ];

        for (const fixture of cases) {
            const caster = actor('caster', 'squad', 0, {
                ai: false,
                character: {
                    specialty: fixture.jutsu.type,
                    level: 100,
                    stats: { ninjutsuOffense: 2_500 },
                    jutsu: [fixture.jutsu],
                },
            });
            const target = actor('target', 'enemy', 8);
            const expectedTarget = fixture.self ? caster : target;
            const reference = applyPvpJutsu(
                towerActorToPvpFighter(caster),
                towerActorToPvpFighter(expectedTarget),
                fixture.jutsu,
                1,
                'central',
                1,
            );
            reference.self.chakra = Math.max(0, reference.self.chakra - Number(fixture.jutsu.chakraCost ?? 0));
            reference.self.stamina = Math.max(0, reference.self.stamina - Number(fixture.jutsu.staminaCost ?? 0));
            const s = begin([caster, target]);
            assert.equal(applyAction(s, floor(), fixture.action, makeRng(1)).applied, true, fixture.name);
            assert.deepEqual(towerReceipt(getActor(s, 'caster')!), fighterReceipt(reference.self), `${fixture.name}: caster`);
            if (!fixture.self) {
                assert.deepEqual(towerReceipt(getActor(s, 'target')!), fighterReceipt(reference.opponent), `${fixture.name}: target`);
            } else {
                assert.deepEqual(towerReceipt(getActor(s, 'target')!), towerReceipt(target), `${fixture.name}: opponent untouched`);
            }
        }

        const noTarget = begin([
            actor('caster', 'squad', 0, {
                ai: false,
                character: { specialty: 'Ninjutsu', level: 100, stats: {}, jutsu: [cases[2]!.jutsu] },
            }),
            actor('target', 'enemy', 8),
        ]);
        assert.deepEqual(applyAction(noTarget, floor(), {
            actorId: 'caster', type: 'jutsu', jutsuId: cases[2]!.jutsu.id,
        }, makeRng(1)), { applied: false, reason: 'no-target' }, 'an opponent-affecting mixed utility never self-casts');
    });
});

type PaidActionCase = {
    name: string;
    baseCost: number;
    action: TowerAction;
};

const PAID_ACTIONS: PaidActionCase[] = [
    { name: 'move', baseCost: 30, action: { actorId: 'caster', type: 'move', tile: 1 } },
    { name: 'dash', baseCost: 30, action: { actorId: 'caster', type: 'dash', tile: 2 } },
    { name: 'basic attack', baseCost: 40, action: { actorId: 'caster', type: 'attack', targetId: 'target' } },
    { name: 'basic heal', baseCost: 60, action: { actorId: 'caster', type: 'heal' } },
    { name: 'cleanse', baseCost: 60, action: { actorId: 'caster', type: 'cleanse' } },
    { name: 'clear', baseCost: 60, action: { actorId: 'caster', type: 'clear', targetId: 'target' } },
    { name: 'weapon', baseCost: 40, action: { actorId: 'caster', type: 'weapon', itemId: 'blade', targetId: 'target' } },
    { name: 'item', baseCost: 35, action: { actorId: 'caster', type: 'item', itemId: 'tonic' } },
    { name: 'self jutsu', baseCost: 40, action: { actorId: 'caster', type: 'jutsu', jutsuId: 'self' } },
    { name: 'movement jutsu', baseCost: 20, action: { actorId: 'caster', type: 'jutsu', jutsuId: 'flicker', tile: 2 } },
    { name: 'ground jutsu', baseCost: 60, action: { actorId: 'caster', type: 'jutsu', jutsuId: 'mire', tile: 1 } },
    { name: 'targeted jutsu', baseCost: 60, action: { actorId: 'caster', type: 'jutsu', jutsuId: 'strike', targetId: 'target' } },
];

function apMatrixSession(statuses: TowerActor['statuses']): TowerSession {
    const jutsu = [
        { id: 'self', name: 'Self Guard', type: 'Ninjutsu', target: 'SELF', ap: 40, effectPower: 0, tags: [{ name: 'Shield' }] },
        { id: 'flicker', name: 'Flicker', type: 'Taijutsu', target: 'EMPTY_GROUND', ap: 20, range: 5, effectPower: 0, tags: [{ name: 'Move' }] },
        { id: 'mire', name: 'Mire', type: 'Genjutsu', target: 'EMPTY_GROUND', method: 'SINGLE', ap: 60, range: 5, effectPower: 0, tags: [{ name: 'Recoil', percent: 12 }] },
        { id: 'strike', name: 'Strike', type: 'Ninjutsu', target: 'OPPONENT', ap: 60, range: 5, effectPower: 5, tags: [] },
    ];
    const caster = actor('caster', 'squad', 0, {
        ai: false,
        hp: 80_000,
        statuses: [...statuses, { name: 'Wound', rounds: 2, amount: 5, kind: 'negative' }],
        itemCharges: { tonic: 1 },
        character: {
            specialty: 'Ninjutsu',
            level: 100,
            stats: { ninjutsuOffense: 2_500 },
            jutsu,
            equipment: { hand: 'blade', consumable: 'tonic' },
            pvpItems: [
                { id: 'blade', name: 'Blade', slot: 'hand', weaponEp: 10, weaponRange: 4, apCost: 40, weaponCooldown: 2 },
                { id: 'tonic', name: 'Tonic', slot: 'consumable', restoreChakra: 5, apCost: 35 },
            ],
        },
    });
    const target = actor('target', 'enemy', 8, {
        statuses: [{ name: 'Increase Damage Given', rounds: 2, percent: 10, kind: 'positive' }],
    });
    return begin([caster, target]);
}

describe('Tower AP modifier parity for every action family', () => {
    const modifierCases = [
        {
            name: 'Lag',
            statuses: [{ name: 'Lag', rounds: 2, percent: 20, kind: 'negative' as const }],
            modifiers: { lagPct: 20 },
        },
        {
            name: 'Overclock',
            statuses: [{ name: 'Overclock', rounds: 2, percent: 20, kind: 'positive' as const }],
            modifiers: { overclockPct: 20 },
        },
        {
            name: 'Lag + Overclock',
            statuses: [
                { name: 'Lag', rounds: 2, percent: 20, kind: 'negative' as const },
                { name: 'Overclock', rounds: 2, percent: 20, kind: 'positive' as const },
            ],
            modifiers: { lagPct: 20, overclockPct: 20 },
        },
    ];

    for (const modifier of modifierCases) {
        it(`${modifier.name} changes validation and committed spend for every paid action`, () => {
            for (const actionCase of PAID_ACTIONS) {
                const cost = adjustedApCost(actionCase.baseCost, modifier.modifiers);
                const rejected = apMatrixSession(modifier.statuses);
                rejected.activeAp = cost - 1;
                const rejectedResult = applyAction(rejected, floor(), actionCase.action, makeRng(2));
                assert.deepEqual(rejectedResult, { applied: false, reason: 'cannot-act' }, actionCase.name);
                assert.equal(rejected.activeAp, cost - 1, `${actionCase.name}: rejection spends no AP`);
                assert.equal(rejected.actionsThisTurn, 0, `${actionCase.name}: rejection spends no action`);

                const accepted = apMatrixSession(modifier.statuses);
                accepted.activeAp = cost;
                const acceptedResult = applyAction(accepted, floor(), actionCase.action, makeRng(2));
                assert.equal(acceptedResult.applied, true, actionCase.name);
                assert.equal(accepted.activeAp, 0, `${actionCase.name}: spends exactly adjustedApCost`);
                assert.equal(accepted.actionsThisTurn, 1, `${actionCase.name}: commits one paid action`);
            }
        });
    }

    it('keeps wait and companion summon explicitly free under Lag', () => {
        const waitSession = apMatrixSession([{ name: 'Lag', rounds: 2, percent: 99, kind: 'negative' }]);
        assert.equal(applyAction(waitSession, floor(), { actorId: 'caster', type: 'wait' }, makeRng(1)).applied, true);
        assert.equal(waitSession.activeAp, 100);
        assert.equal(waitSession.actionsThisTurn, 0);

        const summonSession = apMatrixSession([{ name: 'Lag', rounds: 2, percent: 99, kind: 'negative' }]);
        summonSession.pendingCompanion = {
            petId: 'pet-1', name: 'Pet', hp: 100, damage: 10, happiness: 100,
            loyal: true, moves: [], pveGearId: '',
        };
        assert.equal(applyAction(summonSession, floor(), { actorId: 'caster', type: 'summon' }, makeRng(1)).applied, true);
        assert.equal(summonSession.activeAp, 100);
        assert.equal(summonSession.actionsThisTurn, 0);
    });
});

describe('Tower jutsu eligibility and resource-spend parity', () => {
    const elementalRoutes = [
        { id: 'direct-fire', element: 'Fire', target: 'OPPONENT', method: 'SINGLE', tags: [], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'direct-fire', targetId: 'target' } },
        { id: 'self-water', element: 'Water', target: 'SELF', method: 'SINGLE', tags: [{ name: 'Shield' }], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'self-water' } },
        { id: 'move-lightning', element: 'Lightning', target: 'EMPTY_GROUND', method: 'SINGLE', tags: [{ name: 'Move' }], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'move-lightning', tile: 1 } },
        { id: 'ground-earth', element: 'Earth', target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', tags: [{ name: 'Recoil', percent: 10 }], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'ground-earth', tile: 1 } },
    ] as const;

    function elementalSession(route: typeof elementalRoutes[number], element: string = route.element): TowerSession {
        const jutsu = {
            id: route.id,
            name: route.id,
            type: 'Ninjutsu',
            element,
            target: route.target,
            method: route.method,
            ap: 40,
            range: 5,
            effectPower: route.target === 'OPPONENT' ? 10 : 0,
            chakraCost: 13,
            staminaCost: 7,
            cooldown: 3,
            tags: [...route.tags],
        };
        return begin([
            actor('caster', 'squad', 0, {
                ai: false,
                statuses: [{ name: 'Elemental Seal', rounds: 2, kind: 'negative' }],
                character: { specialty: 'Ninjutsu', level: 100, stats: { ninjutsuOffense: 2_500 }, jutsu: [jutsu] },
            }),
            actor('target', 'enemy', 8),
        ]);
    }

    it('Elemental Seal rejects every elemental Tower jutsu route before any commitment', () => {
        for (const route of elementalRoutes) {
            const s = elementalSession(route);
            const before = {
                actor: structuredClone(getActor(s, 'caster')),
                target: structuredClone(getActor(s, 'target')),
                ap: s.activeAp,
                actions: s.actionsThisTurn,
                groundEffects: structuredClone(s.groundEffects),
            };
            const result = applyAction(s, floor(), route.action as TowerAction, makeRng(3));
            assert.deepEqual(result, { applied: false, reason: 'elementally-sealed' }, route.id);
            assert.deepEqual(getActor(s, 'caster'), before.actor, `${route.id}: no actor/resource/cooldown mutation`);
            assert.deepEqual(getActor(s, 'target'), before.target, `${route.id}: no target mutation`);
            assert.equal(s.activeAp, before.ap, `${route.id}: no AP spend`);
            assert.equal(s.actionsThisTurn, before.actions, `${route.id}: no action spend`);
            assert.deepEqual(s.groundEffects, before.groundEffects, `${route.id}: no zone`);
        }
    });

    it('Elemental Seal does not reject a non-basic element', () => {
        const route = elementalRoutes[0];
        const s = elementalSession(route, 'None');
        assert.equal(applyAction(s, floor(), route.action as TowerAction, makeRng(3)).applied, true);
        assert.equal(getActor(s, 'caster')!.chakra, 487);
        assert.equal(getActor(s, 'caster')!.stamina, 493);
        assert.equal(getActor(s, 'caster')!.cooldowns[route.id], 3);
    });

    const poisonRoutes = [
        { id: 'direct', target: 'OPPONENT', method: 'SINGLE', tags: [], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'direct', targetId: 'target' } },
        { id: 'self', target: 'SELF', method: 'SINGLE', tags: [], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'self' } },
        { id: 'move', target: 'EMPTY_GROUND', method: 'SINGLE', tags: [{ name: 'Move' }], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'move', tile: 1 } },
        { id: 'ground', target: 'EMPTY_GROUND', method: 'SINGLE', tags: [], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'ground', tile: 1 } },
        { id: 'aoe', target: 'OPPONENT', method: 'AOE_BURST', tags: [], action: { actorId: 'caster', type: 'jutsu', jutsuId: 'aoe', targetId: 'target' } },
    ] as const;

    function poisonSession(route: typeof poisonRoutes[number], hp = 1_000): TowerSession {
        const jutsu = {
            id: route.id,
            name: route.id,
            type: 'Ninjutsu',
            element: 'None',
            target: route.target,
            method: route.method,
            ap: 40,
            range: 5,
            effectPower: 0,
            chakraCost: 20,
            staminaCost: 10,
            cooldown: 3,
            tags: [...route.tags],
        };
        return begin([
            actor('caster', 'squad', 0, {
                ai: false,
                hp,
                maxHp: 1_000,
                statuses: [
                    { name: 'Poison', rounds: 2, percent: 10, kind: 'negative' },
                    { name: 'Poison', rounds: 2, percent: 5, kind: 'negative' },
                ],
                character: { specialty: 'Ninjutsu', level: 100, stats: {}, jutsu: [jutsu] },
            }),
            actor('target', 'enemy', 8),
            ...(route.id === 'aoe' ? [actor('target-2', 'enemy', 1), actor('target-3', 'enemy', 9)] : []),
        ]);
    }

    it('combat-resources-v2 Poison charges once for every Tower jutsu route, including N-target AOE', () => {
        const poisonDamage = v2PoisonOnSpend(30, 15);
        for (const route of poisonRoutes) {
            const s = poisonSession(route);
            assert.equal(applyAction(s, floor(), route.action as TowerAction, makeRng(4)).applied, true, route.id);
            const caster = getActor(s, 'caster')!;
            assert.equal(caster.hp, 1_000 - poisonDamage, route.id);
            assert.equal(caster.chakra, 480, route.id);
            assert.equal(caster.stamina, 490, route.id);
            assert.equal(caster.cooldowns[route.id], 3, route.id);
            assert.equal(s.log.filter(line => line.includes('Poison damage from exertion.')).length, 1, route.id);
        }
    });

    it('resolves lethal Poison exertion before awarding a Tower winner', () => {
        const route = poisonRoutes[0];
        const poisonDamage = v2PoisonOnSpend(30, 15);
        const s = poisonSession(route, poisonDamage);
        assert.equal(applyAction(s, floor(), route.action as TowerAction, makeRng(4)).applied, true);
        assert.equal(getActor(s, 'caster')!.hp, 0);
        assert.equal(s.status, 'done');
        assert.equal(s.winner, 'enemy');
    });
});

const BARRIER_JUTSU = {
    id: 'barrier',
    name: 'Tower Wall',
    type: 'Ninjutsu',
    element: 'None',
    target: 'OPPONENT',
    method: 'SINGLE',
    ap: 40,
    range: 5,
    effectPower: 0,
    cooldown: 5,
    tags: [{ name: 'Barrier' }],
};

function barrierSession(withSurvivor = false): TowerSession {
    const caster = actor('caster', 'squad', 28, {
        ai: false,
        character: {
            specialty: 'Ninjutsu', level: 100, stats: { ninjutsuOffense: 2_500 },
            jutsu: [BARRIER_JUTSU],
        },
    });
    const survivor = actor('survivor', 'squad', 20, {
        ai: false,
        character: {
            specialty: 'Genjutsu', level: 100, stats: {},
            jutsu: [{
                id: 'probe', name: 'Probe', type: 'Genjutsu', element: 'None',
                target: 'EMPTY_GROUND', method: 'SINGLE', ap: 20, range: 8,
                effectPower: 0, tags: [],
            }],
        },
    });
    return begin([caster, ...(withSurvivor ? [survivor] : []), actor('target', 'enemy', 31)]);
}

function castBarrier(s: TowerSession): number {
    const result = applyAction(s, floor(), {
        actorId: 'caster', type: 'jutsu', jutsuId: 'barrier', targetId: 'target',
    }, makeRng(5));
    assert.equal(result.applied, true);
    const status = getActor(s, 'caster')!.statuses.find(entry => canonicalTagName(entry.name) === 'Barrier');
    assert.ok(status);
    assert.ok((status as typeof status & { source?: string }).source?.startsWith('tower-grid:'), 'only the Tower-stamped coordinate is board authority');
    assert.equal(status.rounds, 2);
    assert.ok(Number.isInteger(status.amount));
    return status.amount!;
}

describe('Tower-grid Barrier policy', () => {
    it('replaces the PvP coordinate with a deterministic valid Tower tile and blocks all human tile routes', () => {
        const s = barrierSession();
        const tile = castBarrier(s);
        assert.ok(tile >= 0 && tile < MAP.width * MAP.height);
        assert.notEqual(tile, getActor(s, 'caster')!.pos);
        assert.notEqual(tile, getActor(s, 'target')!.pos);
        assert.equal(s.log.some(line => line.startsWith('Barrier:') && line.includes('Tower hex')), true);
        assert.equal(s.log.some(line => line.startsWith('Barrier:') && line.includes('blocks hex')), false,
            'the shared PvP-grid coordinate never leaks into the Tower receipt');

        const caster = getActor(s, 'caster')!;
        caster.character.jutsu = [
            BARRIER_JUTSU,
            { id: 'flicker', name: 'Flicker', type: 'Taijutsu', target: 'EMPTY_GROUND', ap: 20, range: 5, effectPower: 0, tags: [{ name: 'Move' }] },
            { id: 'mire', name: 'Mire', type: 'Genjutsu', target: 'EMPTY_GROUND', method: 'SINGLE', ap: 20, range: 5, effectPower: 0, tags: [{ name: 'Recoil', percent: 10 }] },
        ];
        const routes: TowerAction[] = [
            { actorId: 'caster', type: 'move', tile },
            { actorId: 'caster', type: 'dash', tile },
            { actorId: 'caster', type: 'jutsu', jutsuId: 'flicker', tile },
            { actorId: 'caster', type: 'jutsu', jutsuId: 'mire', tile },
        ];
        for (const action of routes) {
            const attempt = structuredClone(s);
            const apBefore = attempt.activeAp;
            assert.deepEqual(applyAction(attempt, floor(), action, makeRng(5)), { applied: false, reason: 'blocked' });
            assert.equal(attempt.activeAp, apBefore);
        }
    });

    it('feeds AI pathing, companion placement, displacement, and reinforcement entry from one tile authority', () => {
        const base = barrierSession();
        const tile = castBarrier(base);

        const ai = structuredClone(base);
        const aiCaster = getActor(ai, 'caster')!;
        aiCaster.character.jutsu = [];
        const move = pickAiAction(ai, aiCaster, makeRng(6));
        assert.equal(move.type, 'move');
        if (move.type === 'move') assert.notEqual(move.tile, tile, 'AI path never selects the wall');

        const summon = structuredClone(base);
        summon.pendingCompanion = {
            petId: 'pet-1', name: 'Pet', hp: 100, damage: 10, happiness: 100,
            loyal: true, moves: [], pveGearId: '',
        };
        assert.equal(applyAction(summon, floor(), { actorId: 'caster', type: 'summon' }, makeRng(6)).applied, true);
        assert.notEqual(getActor(summon, 'companion-0')!.pos, tile, 'summons avoid the wall');

        const reinforced = structuredClone(base);
        reinforced.pendingEnemyWaves = [{ round: reinforced.round, actors: [actor('reinforcement', 'enemy', tile)] }];
        startRound(reinforced);
        assert.notEqual(getActor(reinforced, 'reinforcement')!.pos, tile, 'reinforcements avoid the wall');

        const trigger = {
            id: 'trigger', name: 'Trigger', type: 'Ninjutsu', element: 'None', target: 'OPPONENT',
            method: 'SINGLE', ap: 60, range: 5, effectPower: 100, tags: [],
        };
        const phaseSummon = begin([
            actor('caster', 'squad', 28, {
                ai: false,
                character: {
                    specialty: 'Ninjutsu', level: 100, stats: { ninjutsuOffense: 2_500 },
                    jutsu: [BARRIER_JUTSU, trigger],
                },
            }),
            actor('target', 'enemy', 30, {
                hp: 1_000,
                maxHp: 1_000,
                character: {
                    specialty: 'Taijutsu', level: 100, stats: {}, mechanic: 'summon', summonCount: 6,
                    summonTemplate: { name: 'Phase Add', specialty: 'Taijutsu', hp: 100, stats: {} },
                },
            }),
        ]);
        phaseSummon.phaseState.bossId = 'target';
        phaseSummon.phaseState.pendingPhases = [99];
        const phaseBarrierTile = castBarrier(phaseSummon);
        assert.equal(applyAction(phaseSummon, floor(), {
            actorId: 'caster', type: 'jutsu', jutsuId: 'trigger', targetId: 'target',
        }, makeRng(6)).applied, true);
        assert.ok(phaseSummon.actors.some(entry => entry.id.startsWith('add-')), 'phase gate summoned its reinforcements');
        assert.equal(phaseSummon.actors.some(entry => entry.id.startsWith('add-') && entry.pos === phaseBarrierTile), false,
            'phase-gate reinforcements also avoid the wall');

        const pullJutsu = {
            id: 'pull', name: 'Pull', type: 'Ninjutsu', element: 'None', target: 'OPPONENT',
            method: 'SINGLE', ap: 40, range: 5, effectPower: 40, tags: [{ name: 'Pull' }],
        };
        const walled = begin([
            actor('caster', 'squad', 0, {
                ai: false,
                statuses: [{ name: 'Barrier', source: 'tower-grid:test', rounds: 2, amount: 1, kind: 'positive' } as TowerActor['statuses'][number] & { source: string }],
                character: {
                    specialty: 'Ninjutsu', level: 100, stats: { ninjutsuOffense: 2_500 },
                    jutsu: [pullJutsu],
                },
            }),
            actor('target', 'enemy', 2),
        ]);
        const control = structuredClone(walled);
        getActor(control, 'caster')!.statuses = getActor(control, 'caster')!.statuses
            .filter(status => canonicalTagName(status.name) !== 'Barrier');
        assert.equal(applyAction(walled, floor(), { actorId: 'caster', type: 'jutsu', jutsuId: 'pull', targetId: 'target' }, makeRng(6)).applied, true);
        assert.equal(applyAction(control, floor(), { actorId: 'caster', type: 'jutsu', jutsuId: 'pull', targetId: 'target' }, makeRng(6)).applied, true);
        const walledTarget = getActor(walled, 'target')!;
        const controlTarget = getActor(control, 'target')!;
        assert.equal(walledTarget.pos, 2, 'the only toward tile is blocked, so Pull stops');
        assert.equal(controlTarget.pos, 1, 'the same Pull enters that tile without the wall');
    });

    it('persists after caster defeat for the original duration, then expires deterministically', () => {
        const s = barrierSession(true);
        const tile = castBarrier(s);
        getActor(s, 'caster')!.hp = 0;
        startRound(s);
        assert.equal(getActor(s, 'survivor')!.id, s.turnQueue[s.activeIndex]);

        const probe: TowerAction = { actorId: 'survivor', type: 'jutsu', jutsuId: 'probe', tile };
        assert.deepEqual(applyAction(s, floor(), probe, makeRng(7)), { applied: false, reason: 'blocked' });
        endTurn(s, floor());
        endTurn(s, floor());
        assert.equal(getActor(s, 'caster')!.statuses.find(status => canonicalTagName(status.name) === 'Barrier')?.rounds, 1);
        assert.deepEqual(applyAction(s, floor(), probe, makeRng(7)), { applied: false, reason: 'blocked' });

        endTurn(s, floor());
        endTurn(s, floor());
        assert.equal(getActor(s, 'caster')!.statuses.some(status => canonicalTagName(status.name) === 'Barrier'), false);
        assert.equal(applyAction(s, floor(), probe, makeRng(7)).applied, true, 'the expired tile becomes legal again');
    });
});

describe('EMPTY_GROUND spiral parity', () => {
    it('creates the canonical radius-two footprint and immediately applies Recoil', () => {
        const spiral = {
            id: 'spiral-recoil', name: 'Spiral Recoil', type: 'Genjutsu', element: 'None',
            ap: 60, range: 10, effectPower: 0, target: 'EMPTY_GROUND',
            method: 'AOE_SPIRAL', cooldown: 4, tags: [{ name: 'Recoil', percent: 12 }],
        };
        const targetTile = 18;
        const s = begin([
            actor('caster', 'squad', 0, {
                ai: false,
                character: { specialty: 'Genjutsu', level: 100, stats: {}, jutsu: [spiral] },
            }),
            actor('target', 'enemy', targetTile),
        ]);
        assert.equal(applyAction(s, floor(), {
            actorId: 'caster', type: 'jutsu', jutsuId: spiral.id, tile: targetTile,
        }, makeRng(8)).applied, true);
        assert.equal(s.groundEffects.length, 1);
        assert.deepEqual(
            [...s.groundEffects[0]!.tiles].sort((a, b) => a - b),
            [...filledDiskTiles(targetTile, 2, s.map.width, s.map.height)].sort((a, b) => a - b),
        );
        assert.equal(s.groundEffects[0]!.tags.some(tag => canonicalTagName(tag.name) === 'Recoil'), true);
        assert.equal(getActor(s, 'target')!.statuses.some(status => canonicalTagName(status.name) === 'Recoil'), true);
    });
});

describe('authored EMPTY_GROUND Recoil kits', () => {
    it('ships canonical persistent Recoil on both Revenant ground-control techniques and resolves it in Tower combat', () => {
        for (const [templateId, jutsuId] of [
            ['boss-revenant', 'revenant-mire'],
            ['spire-revenant', 'spire-revenant-mist'],
        ] as const) {
            const authored = getEnemyTemplate(templateId).jutsu?.find(jutsu => jutsu.id === jutsuId);
            assert.ok(authored, `${templateId}/${jutsuId}`);
            assert.equal(authored.target, 'EMPTY_GROUND');
            assert.equal(authored.method, 'AOE_SPIRAL');
            assert.equal(authored.tags?.some(tag => canonicalTagName(String((tag as { name?: unknown })?.name ?? '')) === 'Recoil'), true);

            const s = begin([
                actor('caster', 'squad', 0, {
                    ai: false,
                    character: { specialty: 'Genjutsu', level: 100, stats: {}, jutsu: [authored] },
                }),
                actor('target', 'enemy', 8),
            ]);
            assert.equal(applyAction(s, floor(), {
                actorId: 'caster', type: 'jutsu', jutsuId, tile: 8,
            }, makeRng(8)).applied, true);
            assert.equal(s.groundEffects.length, 1);
            assert.equal(s.groundEffects[0]!.tags.some(tag => canonicalTagName(tag.name) === 'Recoil'), true);
            assert.equal(getActor(s, 'target')!.statuses.some(status => canonicalTagName(status.name) === 'Recoil'), true);
        }
    });
});
