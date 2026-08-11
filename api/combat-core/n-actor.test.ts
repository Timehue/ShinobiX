import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    actorId,
    controllerId,
    createCombatRules,
    normalizeAbilityTargetRule,
    planAbilityTargets,
    relationFromActor,
    stableActorOrder,
    teamId,
    viewerRelation,
    type ActionIntent,
    type ActorId,
    type CombatActorRef,
} from './n-actor.js';

const A = actorId('actor-a');
const B = actorId('actor-b');
const C = actorId('actor-c');
const D = actorId('actor-d');
const RED = teamId('red');
const BLUE = teamId('blue');
const GREEN = teamId('green');
const SPECTATOR = teamId('spectator');
const PLAYER = controllerId('player');
const OTHER = controllerId('other');

function ref(
    id: ReturnType<typeof actorId>,
    team: ReturnType<typeof teamId>,
    order: number,
    controller = OTHER,
    state: CombatActorRef['state'] = 'active',
): CombatActorRef {
    return { actorId: id, teamId: team, rosterOrder: order, controllerId: controller, state };
}

function abilityIntent(
    target?: ActorId,
    controller = PLAYER,
): ActionIntent {
    return {
        type: 'ability', actorId: A, controllerId: controller, abilityId: 'storm-field',
        ...(target === undefined ? {} : { target: { kind: 'actor' as const, actorId: target } }),
    };
}

function permutations<T>(values: readonly T[]): T[][] {
    if (values.length <= 1) return [[...values]];
    return values.flatMap((value, index) => permutations([
        ...values.slice(0, index), ...values.slice(index + 1),
    ]).map((tail) => [value, ...tail]));
}

describe('canonical N-actor identities and viewer relations', () => {
    it('brands non-empty opaque ids without rewriting their runtime value', () => {
        assert.equal(actorId('A/01'), 'A/01');
        assert.equal(teamId('village:leaf'), 'village:leaf');
        assert.equal(controllerId('socket:42'), 'socket:42');
        assert.throws(() => actorId(''), /non-empty/);
        assert.throws(() => teamId(''), /non-empty/);
        assert.throws(() => controllerId(''), /non-empty/);
    });

    it('derives self/ally/enemy/neutral relative to the viewer, never from controller ownership', () => {
        const self = ref(A, RED, 0, PLAYER);
        const ally = ref(B, RED, 1, OTHER);
        const hostileSameController = ref(C, BLUE, 2, PLAYER);
        const neutral = ref(D, GREEN, 3, OTHER);
        const rules = createCombatRules({
            relationBetweenTeams: (viewerTeam, targetTeam) => (
                viewerTeam === RED && targetTeam === GREEN ? 'neutral' : 'enemy'
            ),
        });

        assert.equal(relationFromActor(self, self, rules), 'self');
        assert.equal(relationFromActor(self, ally, rules), 'ally');
        assert.equal(relationFromActor(self, hostileSameController, rules), 'enemy');
        assert.equal(relationFromActor(self, neutral, rules), 'neutral');
        assert.equal(viewerRelation({ teamId: RED }, self, rules), 'ally', 'team viewer has no self actor');
        assert.equal(viewerRelation({ teamId: SPECTATOR }, self, rules), 'enemy');
    });
});

describe('normalized ability target rules', () => {
    it('normalizes every legacy relation/tile family to one canonical shape', () => {
        const cases = [
            ['SELF', 'actor', ['self']],
            ['ally', 'actor', ['ally']],
            ['friendly-or-self', 'actor', ['self', 'ally']],
            ['OPPONENT', 'actor', ['enemy']],
            ['hostile', 'actor', ['enemy']],
            ['any actor', 'actor', ['self', 'ally', 'enemy', 'neutral']],
            ['EMPTY_GROUND', 'tile', undefined],
            ['occupied tile', 'tile', undefined],
            ['tile', 'tile', undefined],
            ['none', 'none', undefined],
        ] as const;

        for (const [legacy, kind, relations] of cases) {
            const rule = normalizeAbilityTargetRule(legacy);
            assert.equal(rule.kind, kind, legacy);
            if (rule.kind === 'actor') assert.deepEqual(rule.relations, relations, legacy);
        }
        assert.deepEqual(normalizeAbilityTargetRule(undefined), normalizeAbilityTargetRule('OPPONENT'));
        assert.deepEqual(normalizeAbilityTargetRule('EMPTY_GROUND'), { kind: 'tile', occupancy: 'empty' });
        assert.deepEqual(normalizeAbilityTargetRule('OCCUPIED_TILE'), { kind: 'tile', occupancy: 'occupied' });
    });

    it('deduplicates and canonically orders structured relations while validating cardinality', () => {
        assert.deepEqual(normalizeAbilityTargetRule({
            kind: 'actor', relations: ['neutral', 'enemy', 'self', 'enemy', 'ally'],
            minTargets: 2, maxTargets: 'all', primary: 'optional', includeDefeated: true,
        }), {
            kind: 'actor', relations: ['self', 'ally', 'enemy', 'neutral'],
            minTargets: 2, maxTargets: 'all', primary: 'optional', includeDefeated: true,
        });
        assert.throws(() => normalizeAbilityTargetRule({ kind: 'actor', relations: [] }), /at least one relation/);
        assert.throws(() => normalizeAbilityTargetRule({
            kind: 'actor', relations: ['enemy'], minTargets: 2, maxTargets: 1,
        }), /cannot exceed/);
        assert.throws(() => normalizeAbilityTargetRule('surprise-me'), /Unknown ability target rule/);
        assert.throws(() => createCombatRules({ maxTargetsPerCast: 0 }), /positive safe integer/);
    });
});

describe('server-derived TargetPlan', () => {
    const roster = [
        ref(A, RED, 8, PLAYER),
        ref(B, BLUE, 3),
        ref(C, BLUE, 1),
        ref(D, RED, 0),
    ];
    const allEnemies = normalizeAbilityTargetRule({
        kind: 'actor', relations: ['enemy'], minTargets: 1, maxTargets: 'all', primary: 'required',
    });

    it('keeps the chosen anchor first, then uses rosterOrder + ActorId for a total order', () => {
        const result = planAbilityTargets({
            intent: abilityIntent(B), rule: allEnemies, roster,
            expandedActorIds: [C, B, C, D],
        });
        assert.equal(result.accepted, true);
        if (!result.accepted || result.plan.kind !== 'actors') return;
        assert.deepEqual(result.plan.targets.map((target) => target.actorId), [B, C]);
        assert.deepEqual(result.plan.targets.map((target) => target.relation), ['enemy', 'enemy']);
        assert.deepEqual(result.plan.targets.map((target) => target.primary), [true, false]);
    });

    it('is deterministic across every roster and footprint permutation', () => {
        const expected = JSON.stringify(planAbilityTargets({
            intent: abilityIntent(B), rule: allEnemies, roster,
            expandedActorIds: [B, C, D],
        }));
        let checked = 0;
        for (const rosterPermutation of permutations(roster)) {
            for (const footprintPermutation of permutations([B, C, D])) {
                assert.equal(JSON.stringify(planAbilityTargets({
                    intent: abilityIntent(B), rule: allEnemies,
                    roster: rosterPermutation, expandedActorIds: footprintPermutation,
                })), expected);
                checked++;
            }
        }
        assert.equal(checked, 144);
        assert.deepEqual(stableActorOrder([...roster].reverse()).map((actor) => actor.actorId), [D, C, B, A]);
    });

    it('enforces controller authority, primary eligibility, defeated policy, and target caps', () => {
        assert.deepEqual(planAbilityTargets({
            intent: abilityIntent(B, OTHER), rule: allEnemies, roster,
        }), { accepted: false, rejection: 'controller-mismatch' });
        assert.deepEqual(planAbilityTargets({
            intent: abilityIntent(D), rule: allEnemies, roster,
        }), { accepted: false, rejection: 'primary-target-not-allowed' });

        const defeatedRoster = roster.map((actor) => actor.actorId === B ? { ...actor, state: 'defeated' as const } : actor);
        assert.deepEqual(planAbilityTargets({
            intent: abilityIntent(B), rule: allEnemies, roster: defeatedRoster,
        }), { accepted: false, rejection: 'primary-target-not-allowed' });
        const includeDefeated = normalizeAbilityTargetRule({
            kind: 'actor', relations: ['enemy'], includeDefeated: true,
        });
        assert.equal(planAbilityTargets({
            intent: abilityIntent(B), rule: includeDefeated, roster: defeatedRoster,
        }).accepted, true);

        assert.deepEqual(planAbilityTargets({
            intent: abilityIntent(B), rule: allEnemies, roster,
            expandedActorIds: [B, C], rules: createCombatRules({ maxTargetsPerCast: 1 }),
        }), { accepted: false, rejection: 'too-many-targets' });
    });

    it('keeps tile/no-target plans free of actor expansion and rejects target-kind confusion', () => {
        const tileIntent: ActionIntent = {
            type: 'ability', actorId: A, controllerId: PLAYER, abilityId: 'flame-zone',
            target: { kind: 'tile', tile: 42 },
        };
        const tile = planAbilityTargets({
            intent: tileIntent, rule: normalizeAbilityTargetRule('EMPTY_GROUND'), roster,
        });
        assert.equal(tile.accepted, true);
        if (tile.accepted) assert.deepEqual(tile.plan.targets, []);

        const noTargetIntent: ActionIntent = {
            type: 'ability', actorId: A, controllerId: PLAYER, abilityId: 'battle-cry',
        };
        assert.equal(planAbilityTargets({
            intent: noTargetIntent, rule: normalizeAbilityTargetRule('NONE'), roster,
        }).accepted, true);
        assert.deepEqual(planAbilityTargets({
            intent: abilityIntent(B), rule: normalizeAbilityTargetRule('NONE'), roster,
        }), { accepted: false, rejection: 'target-kind-mismatch' });
    });
});

describe('explicit 2v2 human-controller team contract', () => {
    const redOne = controllerId('red-player-1');
    const redTwo = controllerId('red-player-2');
    const blueOne = controllerId('blue-player-1');
    const blueTwo = controllerId('blue-player-2');
    const roster = [
        ref(A, RED, 0, redOne),
        ref(B, RED, 1, redTwo),
        ref(C, BLUE, 2, blueOne),
        ref(D, BLUE, 3, blueTwo),
    ];
    const intent = (source: ActorId, controller: ReturnType<typeof controllerId>, target: ActorId): ActionIntent => ({
        type: 'ability', actorId: source, controllerId: controller, abilityId: 'team-technique',
        target: { kind: 'actor', actorId: target },
    });

    it('enforces per-actor authority and self/ally/hostile targeting while server AOE excludes allies', () => {
        const rules = createCombatRules();
        assert.equal(relationFromActor(roster[0]!, roster[0]!, rules), 'self');
        assert.equal(relationFromActor(roster[0]!, roster[1]!, rules), 'ally');
        assert.equal(relationFromActor(roster[0]!, roster[2]!, rules), 'enemy');

        assert.equal(planAbilityTargets({
            intent: intent(A, redOne, A), rule: normalizeAbilityTargetRule('SELF'), roster,
        }).accepted, true);
        assert.equal(planAbilityTargets({
            intent: intent(A, redOne, B), rule: normalizeAbilityTargetRule('ALLY'), roster,
        }).accepted, true);
        assert.deepEqual(planAbilityTargets({
            intent: intent(A, redTwo, C), rule: normalizeAbilityTargetRule('OPPONENT'), roster,
        }), { accepted: false, rejection: 'controller-mismatch' });

        for (const [source, owner, hostile] of [
            [A, redOne, C], [B, redTwo, C], [C, blueOne, A], [D, blueTwo, A],
        ] as const) {
            assert.equal(planAbilityTargets({
                intent: intent(source, owner, hostile), rule: normalizeAbilityTargetRule('OPPONENT'), roster,
            }).accepted, true, `${source} is controlled only by its own human`);
        }

        const hostileAoe = normalizeAbilityTargetRule({
            kind: 'actor', relations: ['enemy'], minTargets: 1, maxTargets: 'all', primary: 'required',
        });
        const expected = planAbilityTargets({
            intent: intent(A, redOne, C), rule: hostileAoe, roster,
            expandedActorIds: [B, D, A, C],
        });
        assert.equal(expected.accepted, true);
        if (!expected.accepted || expected.plan.kind !== 'actors') return;
        assert.deepEqual(expected.plan.targets.map(target => target.actorId), [C, D]);
        assert.deepEqual(expected.plan.targets.map(target => target.relation), ['enemy', 'enemy']);

        for (const permuted of permutations(roster)) {
            const planned = planAbilityTargets({
                intent: intent(A, redOne, C), rule: hostileAoe, roster: permuted,
                expandedActorIds: [D, B, C, A],
            });
            assert.deepEqual(planned, expected, 'roster array order is never team-mode authority');
        }
    });
});
