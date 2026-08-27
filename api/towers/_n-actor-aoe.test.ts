import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from '../pvp/move.js';
import { towerActorToPvpFighter } from '../combat-adapters/clanBossAdapter.js';
import type { PvpFighter } from '../pvp/session.js';
import type { TowerFloor } from './_floor-catalog.js';
import { applyAction, startRound } from './_engine.js';
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
        ai: true,
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
        character: { specialty: 'Taijutsu', level: 100, stats: {} },
        ...over,
    };
}

function floor(): TowerFloor {
    return {
        id: 77,
        name: 'N-actor AOE',
        biome: 'central',
        objective: 'defeat-all',
        roundBudget: 8,
        map: { width: 8, height: 8 },
        fieldRule: { kind: 'none' },
        enemies: [],
        firstClearReward: {},
    };
}

function session(actors: TowerActor[]): TowerSession {
    return createTowerSession({
        towerId: 'aoe-test',
        runId: 'aoe-run',
        floor: 77,
        seed: 77,
        partySize: 1,
        map: MAP,
        actors,
        objectiveKind: 'defeat-all',
        now: 1_000,
    });
}

function cast(s: TowerSession, targetId = 'target-b') {
    startRound(s);
    return applyAction(s, floor(), {
        actorId: 'caster',
        type: 'jutsu',
        jutsuId: 'manyfold',
        targetId,
    }, makeRng(4));
}

function fighterReceipt(fighter: PvpFighter) {
    return {
        hp: fighter.hp,
        chakra: fighter.chakra,
        stamina: fighter.stamina,
        shield: fighter.shield,
        statuses: fighter.statuses,
    };
}

function actorReceipt(entry: TowerActor) {
    return fighterReceipt(towerActorToPvpFighter(entry));
}

describe('Tower N-actor AOE cutover', () => {
    it('is byte-identical to the shared two-actor resolver plus the Tower resource shell', () => {
        const jutsu = {
            id: 'manyfold', name: 'Manyfold', type: 'Taijutsu', target: 'OPPONENT',
            method: 'AOE_BURST', effectPower: 25, ap: 60, range: 4,
            chakraCost: 25, staminaCost: 10, cooldown: 4,
            tags: [
                { name: 'Increase Damage Given', percent: 20 },
                { name: 'Wound', percent: 20 },
                { name: 'Siphon', percent: 15 },
            ],
        };
        const caster = actor('caster', 'squad', 0, {
            ai: false,
            hp: 2_000,
            maxHp: 5_000,
            statuses: [
                { name: 'Recoil', rounds: 2, percent: 25, kind: 'negative' },
                { name: 'Lifesteal', rounds: 2, percent: 20, kind: 'positive' },
            ],
            character: {
                specialty: 'Taijutsu', level: 100,
                stats: { taijutsuOffense: 2_500 },
                itemLifeStealPct: 10,
                jutsu: [jutsu],
            },
        });
        const target = actor('target-b', 'enemy', 1, {
            shield: 100,
            statuses: [
                { name: 'Reflect', rounds: 2, percent: 20, kind: 'positive' },
                { name: 'Absorb', rounds: 2, percent: 10, kind: 'positive' },
            ],
            character: {
                specialty: 'Taijutsu', level: 100,
                stats: { taijutsuDefense: 500 },
                itemReflectPct: 5,
                itemAbsorbPct: 5,
            },
        });
        const reference = applyJutsu(
            towerActorToPvpFighter(caster),
            towerActorToPvpFighter(target),
            jutsu,
            1,
            'central',
            1,
        );
        const s = session([caster, target]);

        assert.equal(cast(s).applied, true);

        const expectedSelf = {
            ...fighterReceipt(reference.self),
            chakra: reference.self.chakra - 25,
            stamina: reference.self.stamina - 10,
        };
        assert.deepEqual(actorReceipt(getActor(s, 'caster')!), expectedSelf);
        assert.deepEqual(actorReceipt(getActor(s, 'target-b')!), fighterReceipt(reference.opponent));
        assert.equal(s.activeAp, 40);
        assert.equal(s.actionsThisTurn, 1);
        assert.equal(getActor(s, 'caster')!.cooldowns.manyfold, 4);
        assert.deepEqual(s.log, [
            'caster uses Manyfold → target-b.',
            ...reference.lines,
        ]);
    });

    function reactionRoster(enemyOrder = ['target-b', 'target-a', 'target-c', 'target-d']): TowerActor[] {
        const jutsu = {
            id: 'manyfold', name: 'Manyfold', type: 'Taijutsu', target: 'OPPONENT',
            method: 'AOE_BURST', effectPower: 25, ap: 60, range: 4,
            chakraCost: 25, staminaCost: 10, cooldown: 4,
            tags: [
                { name: 'Increase Generals', percent: 20 },
                { name: 'Lifesteal', percent: 10 },
                { name: 'Siphon', percent: 15 },
                { name: 'Wound', percent: 20 },
                { name: 'Poison', percent: 10 },
            ],
        };
        const caster = actor('caster', 'squad', 0, {
            ai: false,
            hp: 2_000,
            maxHp: 10_000,
            statuses: [
                { name: 'Recoil', rounds: 2, percent: 30, kind: 'negative' },
                { name: 'Lifesteal', rounds: 2, percent: 25, kind: 'positive' },
            ],
            character: {
                specialty: 'Taijutsu', level: 100,
                stats: { taijutsuOffense: 2_500 },
                itemLifeStealPct: 10,
                jutsu: [jutsu],
            },
        });
        const positions: Record<string, number> = {
            'target-b': 1,
            'target-a': 2,
            'target-c': 8,
            'target-d': 9,
        };
        const shields: Record<string, number> = {
            'target-b': 80,
            'target-a': 0,
            'target-c': 120,
            'target-d': 40,
        };
        const reflects: Record<string, number> = {
            'target-b': 20,
            'target-a': 10,
            'target-c': 30,
            'target-d': 15,
        };
        const absorbs: Record<string, number> = {
            'target-b': 10,
            'target-a': 5,
            'target-c': 20,
            'target-d': 15,
        };
        const enemies = Object.keys(positions).map(id => actor(id, 'enemy', positions[id]!, {
            shield: shields[id]!,
            statuses: [
                { name: 'Reflect', rounds: 2, percent: reflects[id]!, kind: 'positive' },
                { name: 'Absorb', rounds: 2, percent: absorbs[id]!, kind: 'positive' },
            ],
            character: {
                specialty: 'Taijutsu', level: 100,
                stats: { taijutsuDefense: 500 },
                itemReflectPct: 5,
                itemAbsorbPct: 5,
            },
        }));
        return [caster, ...enemyOrder.map(id => enemies.find(entry => entry.id === id)!)];
    }

    function normalizedOutcome(s: TowerSession) {
        return {
            caster: actorReceipt(getActor(s, 'caster')!),
            enemies: ['target-a', 'target-b', 'target-c', 'target-d'].map(id => ({
                id,
                ...actorReceipt(getActor(s, id)!),
            })),
            ap: s.activeAp,
            actions: s.actionsThisTurn,
            cooldowns: getActor(s, 'caster')!.cooldowns,
            log: s.log,
        };
    }

    it('accumulates every hit-scoped defender mutation and caster reaction sequentially', () => {
        const s = session(reactionRoster());
        const lifestealBefore = getActor(s, 'caster')!.statuses.filter(status => status.name === 'Lifesteal').length;
        assert.equal(cast(s).applied, true);
        const outcome = normalizedOutcome(s);

        assert.equal(outcome.ap, 40, 'AP is cast-scoped');
        assert.equal(getActor(s, 'caster')!.chakra, 475, 'chakra is spent once');
        assert.equal(getActor(s, 'caster')!.stamina, 490, 'stamina is spent once');
        assert.equal(outcome.cooldowns.manyfold, 4, 'cooldown is armed once');
        assert.equal(getActor(s, 'caster')!.statuses.filter(status =>
            status.name === 'Increase Generals').length, 1, 'self buff setup occurs once');
        assert.equal(getActor(s, 'caster')!.statuses.filter(status =>
            status.name === 'Lifesteal').length, lifestealBefore + 1, 'cast Lifesteal setup occurs once');

        for (const id of ['target-a', 'target-b', 'target-c', 'target-d']) {
            const victim = getActor(s, id)!;
            const initialShield = ({ 'target-a': 0, 'target-b': 80, 'target-c': 120, 'target-d': 40 } as const)[id as 'target-a'];
            assert.ok(victim.hp < victim.maxHp, `${id} takes damage`);
            assert.ok(victim.shield <= initialShield, `${id} never gains shield`);
            if (initialShield > 0) assert.ok(victim.shield < initialShield, `${id} spends shield`);
            assert.equal(victim.statuses.filter(status => status.name === 'Wound').length, 1);
            assert.equal(victim.statuses.filter(status => status.name === 'Poison').length, 1);
        }

        assert.equal(s.log.filter(line => line.includes('reflected damage.')).length, 4, 'active Reflect reacts per target');
        assert.equal(s.log.filter(line => line.includes('damage reflected by') && line.includes('armor')).length, 4, 'item reflect reacts per target');
        assert.equal(s.log.filter(line => line.includes("caster's armor steals")).length, 4, 'item lifesteal reacts per target');
        assert.equal(s.log.filter(line => line.startsWith('Recoil: caster takes')).length, 4, 'active Recoil reacts per target');
        assert.equal(s.log.filter(line => line.startsWith('Lifesteal: caster heals') && line.endsWith(' HP.')).length, 4, 'active Lifesteal reacts per target');
        assert.equal(s.log.filter(line => line.startsWith('Siphon: caster heals')).length, 4, 'Siphon reacts per target');
        assert.equal(s.log.filter(line => line.includes('absorbed by') && line.includes('shield')).length, 3, 'each non-empty shield mutates once');
        assert.equal(s.log.filter(line => line.includes(' absorbs ') && !line.includes('armor absorbs') && line.endsWith(' HP.')).length, 4, 'active Absorb reacts per target');
        assert.equal(s.log.filter(line => line.includes("armor absorbs")).length, 4, 'item absorb reacts per target');
        assert.equal(s.log.at(-1), 'The blast also catches target-a, target-c, target-d.');

        // Exact receipt pins the sequential combination of reflect/recoil/heals and
        // each target's shield/absorb/wound/status mutations. This fixture has no
        // mastery entry, so its authored 15% Siphon resolves at the level-0 5%.
        assert.deepEqual({
            casterHp: outcome.caster.hp,
            targets: outcome.enemies.map(entry => [entry.id, entry.hp, entry.shield]),
        }, {
            casterHp: 1_797,
            targets: [
                ['target-a', 99_594, 0],
                ['target-b', 99_685, 0],
                ['target-c', 99_752, 0],
                ['target-d', 99_671, 0],
            ],
        });
    });

    it('is roster-permutation deterministic with canonical primary-first then actor-id order', () => {
        const orders = [
            ['target-b', 'target-a', 'target-c', 'target-d'],
            ['target-d', 'target-c', 'target-a', 'target-b'],
            ['target-a', 'target-d', 'target-b', 'target-c'],
            ['target-c', 'target-b', 'target-d', 'target-a'],
        ];
        const outcomes = orders.map(order => {
            const s = session(reactionRoster(order));
            assert.equal(cast(s).applied, true);
            return normalizedOutcome(s);
        });
        for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome, outcomes[0]);
    });

    it('applies cast-scoped Heal and Shield once while hostile statuses land on every victim', () => {
        const jutsu = {
            id: 'manyfold', name: 'Manyfold', type: 'Ninjutsu', target: 'OPPONENT',
            method: 'AOE_BURST', effectPower: 50, ap: 60, range: 4,
            chakraCost: 20, cooldown: 3,
            tags: [
                { name: 'Heal' },
                { name: 'Shield' },
                { name: 'Poison', percent: 10 },
            ],
        };
        const caster = actor('caster', 'squad', 0, {
            ai: false,
            hp: 100,
            maxHp: 5_000,
            shield: 0,
            character: {
                specialty: 'Ninjutsu', level: 100,
                stats: { ninjutsuOffense: 2_500 },
                jutsu: [jutsu],
            },
        });
        const enemies = [
            actor('target-b', 'enemy', 1),
            actor('target-a', 'enemy', 2),
            actor('target-c', 'enemy', 8),
        ];
        const setupReference = applyJutsu(
            towerActorToPvpFighter(caster),
            towerActorToPvpFighter(enemies[0]!),
            { ...jutsu, tags: [{ name: 'Heal' }, { name: 'Shield' }] },
            1,
            'central',
            1,
            0,
        );
        const s = session([caster, ...enemies]);

        assert.equal(cast(s).applied, true);
        assert.equal(getActor(s, 'caster')!.hp, setupReference.self.hp);
        assert.equal(getActor(s, 'caster')!.shield, setupReference.self.shield);
        assert.equal(s.log.filter(line => line.startsWith('Heal: caster')).length, 1);
        assert.equal(s.log.filter(line => line.startsWith('Shield: caster')).length, 1);
        // CHANGED 2026-08-16 (owner ruling): Heal/Shield are payloads, not a trade —
        // a 60-AP DAMAGE cast keeps its damage and heals/shields on top. Only Barrier
        // still zeroes a cast. The 40-AP utility split is untouched and enforced
        // upstream by isZeroDamageFortyApJutsu, so a real support jutsu still hits for
        // nothing. This is the towers AOE path; the single-target twin lives in
        // api/pvp/_weapon-damage.test.ts.
        for (const id of ['target-a', 'target-b', 'target-c']) {
            const victim = getActor(s, id)!;
            assert.ok(victim.hp < victim.maxHp, `${id} should take the AOE's damage alongside the caster's heal`);
            assert.equal(victim.statuses.filter(status => status.name === 'Poison').length, 1);
        }
        assert.equal(s.activeAp, 40);
        assert.equal(getActor(s, 'caster')!.chakra, 480);
        assert.equal(getActor(s, 'caster')!.cooldowns.manyfold, 3);
    });

    it('finishes a committed cast after primary Reflect defeats the caster', () => {
        const jutsu = {
            id: 'manyfold', name: 'Manyfold', type: 'Taijutsu', target: 'OPPONENT',
            method: 'AOE_BURST', effectPower: 25, ap: 60, range: 4,
        };
        const caster = actor('caster', 'squad', 0, {
            ai: false,
            hp: 1,
            maxHp: 10_000,
            character: {
                specialty: 'Taijutsu', level: 100,
                stats: { taijutsuOffense: 2_500 },
                jutsu: [jutsu],
            },
        });
        const enemies = [
            actor('target-b', 'enemy', 1, {
                statuses: [{ name: 'Reflect', rounds: 2, percent: 60, kind: 'positive' }],
            }),
            actor('target-a', 'enemy', 2),
            actor('target-c', 'enemy', 8),
        ];
        const s = session([caster, ...enemies]);

        assert.equal(cast(s).applied, true);
        assert.equal(getActor(s, 'caster')!.hp, 0);
        for (const id of ['target-a', 'target-b', 'target-c']) {
            assert.ok(getActor(s, id)!.hp < getActor(s, id)!.maxHp, `${id} resolves despite caster defeat`);
        }
    });
});
