import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { postDamageFormula, postDamagePercentAmount } from './formulas.js';
import { reduceNTargetCast, type NTargetCastHooks } from './cast-reducer.js';
import {
    actorId,
    controllerId,
    createCombatRules,
    normalizeAbilityTargetRule,
    planAbilityTargets,
    teamId,
    type ActorId,
    type CombatActorRef,
    type TargetPlan,
} from './n-actor.js';

const CASTER = actorId('caster');
const TARGET_A = actorId('target-a');
const TARGET_B = actorId('target-b');
const TARGET_C = actorId('target-c');
const RED = teamId('red');
const BLUE = teamId('blue');
const PLAYER = controllerId('player');
const SERVER = controllerId('server-ai');

type UnitState = Readonly<{
    hp: number;
    maxHp: number;
    shield: number;
    reflectPct: number;
}>;

type FixtureState = Readonly<{
    ap: number;
    chakra: number;
    castCount: number;
    cooldowns: Readonly<Record<string, number>>;
    units: Readonly<Record<string, UnitState>>;
}>;

type Mutation =
    | Readonly<{ kind: 'spend-ap'; amount: number }>
    | Readonly<{ kind: 'spend-chakra'; amount: number }>
    | Readonly<{ kind: 'set-cooldown'; abilityId: string; rounds: number }>
    | Readonly<{ kind: 'increment-cast-count' }>
    | Readonly<{ kind: 'damage'; actorId: ActorId; amount: number; cause: 'hit' | 'reflect' | 'recoil' }>
    | Readonly<{ kind: 'heal'; actorId: ActorId; amount: number; cause: 'lifesteal' | 'siphon' }>;

type Event =
    | Readonly<{ kind: 'cast-started'; abilityId: string }>
    | Readonly<{ kind: 'cast-completed'; damage: number }>
    | Readonly<{ kind: 'damage' | 'reflect' | 'recoil' | 'lifesteal' | 'siphon'; amount: number }>;

type HitOutput = Readonly<{
    damage: number;
    reflect: number;
    recoil: number;
    lifesteal: number;
    siphon: number;
}>;

const DAMAGE: Readonly<Record<string, number>> = Object.freeze({
    [TARGET_A]: 100,
    [TARGET_B]: 200,
    [TARGET_C]: 300,
});
function fixtureState(casterHp = 500): FixtureState {
    return {
        ap: 100,
        chakra: 500,
        castCount: 0,
        cooldowns: {},
        units: {
            [CASTER]: { hp: casterHp, maxHp: 5_000, shield: 0, reflectPct: 0 },
            [TARGET_A]: { hp: 1_000, maxHp: 1_000, shield: 0, reflectPct: 20 },
            [TARGET_B]: { hp: 1_000, maxHp: 1_000, shield: 0, reflectPct: 10 },
            [TARGET_C]: { hp: 1_000, maxHp: 1_000, shield: 0, reflectPct: 0 },
        },
    };
}

function mutateUnit(
    state: FixtureState,
    id: ActorId,
    update: (unit: UnitState) => UnitState,
): FixtureState {
    const current = state.units[id];
    if (!current) throw new Error(`Missing unit ${id}`);
    return { ...state, units: { ...state.units, [id]: update(current) } };
}

function applyMutation(state: FixtureState, mutation: Mutation): FixtureState {
    switch (mutation.kind) {
        case 'spend-ap':
            return { ...state, ap: state.ap - mutation.amount };
        case 'spend-chakra':
            return { ...state, chakra: state.chakra - mutation.amount };
        case 'set-cooldown':
            return { ...state, cooldowns: { ...state.cooldowns, [mutation.abilityId]: mutation.rounds } };
        case 'increment-cast-count':
            return { ...state, castCount: state.castCount + 1 };
        case 'damage':
            return mutateUnit(state, mutation.actorId, (unit) => ({
                ...unit, hp: Math.max(0, unit.hp - mutation.amount),
            }));
        case 'heal':
            return mutateUnit(state, mutation.actorId, (unit) => ({
                ...unit, hp: Math.min(unit.maxHp, unit.hp + mutation.amount),
            }));
    }
}

function roster(): CombatActorRef[] {
    return [
        { actorId: CASTER, teamId: RED, controllerId: PLAYER, rosterOrder: 9 },
        { actorId: TARGET_A, teamId: BLUE, controllerId: SERVER, rosterOrder: 1 },
        { actorId: TARGET_B, teamId: BLUE, controllerId: SERVER, rosterOrder: 2 },
        { actorId: TARGET_C, teamId: BLUE, controllerId: SERVER, rosterOrder: 3 },
    ];
}

function targetPlan(
    actors = roster(),
    footprint: readonly ActorId[] = [TARGET_A, TARGET_B, TARGET_C],
): TargetPlan {
    const result = planAbilityTargets({
        intent: {
            type: 'ability', actorId: CASTER, controllerId: PLAYER,
            abilityId: 'manyfold-strike', target: { kind: 'actor', actorId: TARGET_B },
        },
        rule: normalizeAbilityTargetRule({
            kind: 'actor', relations: ['enemy'], minTargets: 1,
            maxTargets: 'all', primary: 'required',
        }),
        roster: actors,
        expandedActorIds: footprint,
    });
    if (!result.accepted) throw new Error(result.rejection);
    return result.plan;
}

const hooks: NTargetCastHooks<FixtureState, Mutation, Event, HitOutput> = {
    applyMutation,
    beginCast: ({ plan }) => ({
        mutations: [
            { kind: 'spend-ap', amount: 60 },
            { kind: 'spend-chakra', amount: 100 },
            { kind: 'set-cooldown', abilityId: plan.abilityId, rounds: 5 },
            { kind: 'increment-cast-count' },
        ],
        events: [{ kind: 'cast-started', abilityId: plan.abilityId }],
    }),
    resolveHit: ({ state, target }) => {
        const targetState = state.units[target.actorId]!;
        const post = postDamageFormula({
            damage: DAMAGE[target.actorId]!,
            shield: targetState.shield,
            pierce: false,
            reflectPct: targetState.reflectPct,
            absorbPct: 0,
        });
        const recoil = postDamagePercentAmount(post.finalDmg, 10);
        const lifesteal = postDamagePercentAmount(post.finalDmg, 25);
        const siphon = postDamagePercentAmount(post.finalDmg, 15);
        const mutations: Mutation[] = [
            { kind: 'damage', actorId: target.actorId, amount: post.finalDmg, cause: 'hit' },
            ...(post.reflectedDmg > 0 ? [{
                kind: 'damage' as const, actorId: CASTER, amount: post.reflectedDmg, cause: 'reflect' as const,
            }] : []),
            { kind: 'damage', actorId: CASTER, amount: recoil, cause: 'recoil' },
            { kind: 'heal', actorId: CASTER, amount: lifesteal, cause: 'lifesteal' },
            { kind: 'heal', actorId: CASTER, amount: siphon, cause: 'siphon' },
        ];
        const events: Event[] = [
            { kind: 'damage', amount: post.finalDmg },
            ...(post.reflectedDmg > 0 ? [{ kind: 'reflect' as const, amount: post.reflectedDmg }] : []),
            { kind: 'recoil', amount: recoil },
            { kind: 'lifesteal', amount: lifesteal },
            { kind: 'siphon', amount: siphon },
        ];
        return {
            mutations,
            events,
            output: { damage: post.finalDmg, reflect: post.reflectedDmg, recoil, lifesteal, siphon },
        };
    },
    completeCast: ({ resolvedHits }) => ({
        events: [{
            kind: 'cast-completed',
            damage: resolvedHits.reduce((sum, hit) => sum + (hit.output?.damage ?? 0), 0),
        }],
    }),
    isActorDefeated: (state, id) => (state.units[id]?.hp ?? 0) <= 0,
};

function permutations<T>(values: readonly T[]): T[][] {
    if (values.length <= 1) return [[...values]];
    return values.flatMap((value, index) => permutations([
        ...values.slice(0, index), ...values.slice(index + 1),
    ]).map((tail) => [value, ...tail]));
}

describe('N-target cast reducer scopes', () => {
    it('commits cast mutations once and resolves reactive mutations once per target', () => {
        const result = reduceNTargetCast({ state: fixtureState(), plan: targetPlan(), hooks });

        assert.equal(result.state.ap, 40);
        assert.equal(result.state.chakra, 400);
        assert.equal(result.state.cooldowns['manyfold-strike'], 5);
        assert.equal(result.state.castCount, 1);
        assert.deepEqual(result.resolvedHits.map((hit) => hit.targetId), [TARGET_B, TARGET_A, TARGET_C]);
        assert.deepEqual(result.resolvedHits.map((hit) => hit.output?.damage), [200, 100, 300]);
        assert.equal(result.state.units[TARGET_A]?.hp, 900);
        assert.equal(result.state.units[TARGET_B]?.hp, 800);
        assert.equal(result.state.units[TARGET_C]?.hp, 700);

        const totals = result.resolvedHits.reduce((sum, hit) => ({
            reflect: sum.reflect + (hit.output?.reflect ?? 0),
            recoil: sum.recoil + (hit.output?.recoil ?? 0),
            lifesteal: sum.lifesteal + (hit.output?.lifesteal ?? 0),
            siphon: sum.siphon + (hit.output?.siphon ?? 0),
        }), { reflect: 0, recoil: 0, lifesteal: 0, siphon: 0 });
        assert.deepEqual(totals, { reflect: 40, recoil: 60, lifesteal: 150, siphon: 90 });
        assert.equal(result.state.units[CASTER]?.hp, 640, '500 - 40 reflect - 60 recoil + 150 LS + 90 Siphon');

        const castMutations = result.mutations.filter((entry) => entry.scope === 'cast');
        const hitMutations = result.mutations.filter((entry) => entry.scope === 'hit');
        assert.equal(castMutations.length, 4);
        assert.ok(castMutations.every((entry) => entry.phase === 'begin'));
        assert.equal(hitMutations.filter((entry) => entry.mutation.kind === 'damage'
            && entry.mutation.cause === 'reflect').length, 2);
        assert.equal(hitMutations.filter((entry) => entry.mutation.kind === 'damage'
            && entry.mutation.cause === 'recoil').length, 3);
        assert.equal(hitMutations.filter((entry) => entry.mutation.kind === 'heal'
            && entry.mutation.cause === 'lifesteal').length, 3);
        assert.equal(hitMutations.filter((entry) => entry.mutation.kind === 'heal'
            && entry.mutation.cause === 'siphon').length, 3);

        const castEvents = result.events.filter((entry) => entry.scope === 'cast');
        assert.deepEqual(castEvents.map((entry) => [entry.phase, entry.event.kind]), [
            ['begin', 'cast-started'], ['complete', 'cast-completed'],
        ]);
        assert.ok(result.events.filter((entry) => entry.scope === 'hit')
            .every((entry) => ['damage', 'reflect', 'recoil', 'lifesteal', 'siphon'].includes(entry.event.kind)));
    });

    it('produces byte-identical state, hit records, and event order for all roster/footprint permutations', () => {
        const baseline = reduceNTargetCast({ state: fixtureState(), plan: targetPlan(), hooks });
        const expected = JSON.stringify({
            state: baseline.state,
            hits: baseline.resolvedHits,
            mutations: baseline.mutations,
            events: baseline.events,
        });
        let checked = 0;
        for (const rosterPermutation of permutations(roster())) {
            for (const footprintPermutation of permutations([TARGET_A, TARGET_B, TARGET_C])) {
                const result = reduceNTargetCast({
                    state: fixtureState(),
                    plan: targetPlan(rosterPermutation, footprintPermutation),
                    hooks,
                });
                assert.equal(JSON.stringify({
                    state: result.state,
                    hits: result.resolvedHits,
                    mutations: result.mutations,
                    events: result.events,
                }), expected);
                checked++;
            }
        }
        assert.equal(checked, 144);
    });

    it('resolves a committed cast atomically by default, with an explicit stop-on-caster-defeat policy', () => {
        type TinyState = Readonly<Record<string, number>>;
        type TinyMutation = Readonly<{ id: ActorId; damage: number }>;
        const tinyHooks: NTargetCastHooks<TinyState, TinyMutation, string, number> = {
            applyMutation: (state, mutation) => ({
                ...state, [mutation.id]: Math.max(0, (state[mutation.id] ?? 0) - mutation.damage),
            }),
            resolveHit: ({ hitIndex }) => ({
                mutations: [
                    { id: CASTER, damage: 10 },
                    { id: [TARGET_B, TARGET_A, TARGET_C][hitIndex]!, damage: 1 },
                ],
                events: ['hit'],
                output: hitIndex,
            }),
            isActorDefeated: (state, id) => (state[id] ?? 0) <= 0,
        };
        const initial: TinyState = { [CASTER]: 5, [TARGET_A]: 5, [TARGET_B]: 5, [TARGET_C]: 5 };
        const atomic = reduceNTargetCast({ state: initial, plan: targetPlan(), hooks: tinyHooks });
        assert.equal(atomic.resolvedHits.length, 3);

        const stops = reduceNTargetCast({
            state: initial,
            plan: targetPlan(),
            hooks: tinyHooks,
            rules: createCombatRules({ continueCastAfterCasterDefeat: false }),
        });
        assert.equal(stops.resolvedHits.length, 1);
        assert.deepEqual(stops.skippedHits.map((hit) => hit.reason), ['caster-defeated', 'caster-defeated']);
    });

    it('runs begin/complete exactly once for a legal zero-hit tile cast', () => {
        const planned = planAbilityTargets({
            intent: {
                type: 'ability', actorId: CASTER, controllerId: PLAYER,
                abilityId: 'empty-field', target: { kind: 'tile', tile: 7 },
            },
            rule: normalizeAbilityTargetRule('EMPTY_GROUND'),
            roster: roster(),
        });
        assert.equal(planned.accepted, true);
        if (!planned.accepted) return;
        const result = reduceNTargetCast({ state: fixtureState(), plan: planned.plan, hooks });
        assert.equal(result.resolvedHits.length, 0);
        assert.equal(result.state.castCount, 1);
        assert.deepEqual(result.events.filter((entry) => entry.scope === 'cast')
            .map((entry) => entry.phase), ['begin', 'complete']);
    });
});
