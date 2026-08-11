/**
 * Generic, pure N-target cast reducer.
 *
 * The reducer owns ordering and scope only.  Mode adapters continue to own
 * formulas, statuses, maps, logs, and their concrete state/mutation/event types.
 * This lets a later cutover reuse today's parity-tested primitives while making
 * one crucial semantic distinction explicit:
 *
 *   cast scope - resource spend, cooldown, cast count, caster setup (once);
 *   hit scope  - target damage/status and reactions derived from that hit
 *                (reflect, recoil, active lifesteal, Siphon, etc.; once/target).
 *
 * `applyMutation` and every hook must be deterministic and treat state as
 * immutable.  A throw produces no reducer result; persistence remains an outer
 * adapter concern.
 */

import {
    DEFAULT_COMBAT_RULES,
    stablePlannedTargetOrder,
    type ActorId,
    type CombatRules,
    type PlannedActorTarget,
    type TargetPlan,
} from './n-actor.js';

export type CastPhase = 'begin' | 'complete';

export type ScopedMutation<TMutation> =
    | Readonly<{
        scope: 'cast';
        phase: CastPhase;
        sequence: number;
        mutation: TMutation;
    }>
    | Readonly<{
        scope: 'hit';
        hitIndex: number;
        targetId: ActorId;
        sequence: number;
        mutation: TMutation;
    }>;

export type ScopedEvent<TEvent> =
    | Readonly<{
        scope: 'cast';
        phase: CastPhase;
        sequence: number;
        event: TEvent;
    }>
    | Readonly<{
        scope: 'hit';
        hitIndex: number;
        targetId: ActorId;
        sequence: number;
        event: TEvent;
    }>;

export type ReducerStep<TMutation, TEvent, TOutput = never> = Readonly<{
    mutations?: readonly TMutation[];
    events?: readonly TEvent[];
    output?: TOutput;
}>;

type CastContextBase<TState> = Readonly<{
    initialState: TState;
    state: TState;
    plan: TargetPlan;
    rules: CombatRules;
}>;

export type CastBeginContext<TState> = CastContextBase<TState>;

export type CastHitContext<TState, THitOutput> = CastContextBase<TState> & Readonly<{
    target: PlannedActorTarget;
    /** Canonical plan position; skipped targets retain their position. */
    hitIndex: number;
    resolvedHits: readonly HitResolution<THitOutput>[];
}>;

export type CastCompleteContext<TState, THitOutput> = CastContextBase<TState> & Readonly<{
    resolvedHits: readonly HitResolution<THitOutput>[];
    skippedHits: readonly SkippedHit[];
}>;

export type HitResolution<THitOutput> = Readonly<{
    hitIndex: number;
    targetId: ActorId;
    mutationCount: number;
    eventCount: number;
    output: THitOutput | undefined;
}>;

export type SkippedHit = Readonly<{
    hitIndex: number;
    targetId: ActorId;
    reason: 'caster-defeated' | 'target-defeated';
}>;

export type NTargetCastHooks<TState, TMutation, TEvent, THitOutput = never> = Readonly<{
    applyMutation: (state: TState, mutation: TMutation) => TState;
    beginCast?: (context: CastBeginContext<TState>) => ReducerStep<TMutation, TEvent>;
    resolveHit: (context: CastHitContext<TState, THitOutput>) => ReducerStep<TMutation, TEvent, THitOutput>;
    completeCast?: (context: CastCompleteContext<TState, THitOutput>) => ReducerStep<TMutation, TEvent>;
    /** Required only when a mode wants defeat-sensitive continuation policy. */
    isActorDefeated?: (state: TState, actorId: ActorId) => boolean;
}>;

export type ReduceNTargetCastInput<TState, TMutation, TEvent, THitOutput = never> = Readonly<{
    state: TState;
    plan: TargetPlan;
    hooks: NTargetCastHooks<TState, TMutation, TEvent, THitOutput>;
    rules?: CombatRules;
}>;

export type NTargetCastResult<TState, TMutation, TEvent, THitOutput = never> = Readonly<{
    state: TState;
    plan: TargetPlan;
    resolvedHits: readonly HitResolution<THitOutput>[];
    skippedHits: readonly SkippedHit[];
    mutations: readonly ScopedMutation<TMutation>[];
    events: readonly ScopedEvent<TEvent>[];
}>;

function assertPlan(plan: TargetPlan, rules: CombatRules): void {
    if (plan.kind !== 'actors') return;
    if (plan.targets.length > rules.maxTargetsPerCast) {
        throw new RangeError('TargetPlan exceeds CombatRules.maxTargetsPerCast.');
    }
    const ids = new Set<ActorId>();
    let primaryCount = 0;
    for (const target of plan.targets) {
        if (ids.has(target.actorId)) throw new TypeError(`TargetPlan repeats actor ${target.actorId}.`);
        ids.add(target.actorId);
        if (target.primary) primaryCount++;
    }
    if (primaryCount > 1) throw new TypeError('TargetPlan contains more than one primary target.');
    if (plan.primaryTargetId !== undefined) {
        const primary = plan.targets.find((target) => target.actorId === plan.primaryTargetId);
        if (!primary || !primary.primary) throw new TypeError('TargetPlan primaryTargetId is inconsistent.');
    } else if (primaryCount > 0) {
        throw new TypeError('TargetPlan marks a primary target without primaryTargetId.');
    }
}
/**
 * Reduce one committed cast. Targets are defensively re-sorted by canonical
 * roster order, so even a hand-built adapter plan cannot reintroduce input-array
 * order as gameplay authority.
 */
export function reduceNTargetCast<TState, TMutation, TEvent, THitOutput = never>(
    input: ReduceNTargetCastInput<TState, TMutation, TEvent, THitOutput>,
): NTargetCastResult<TState, TMutation, TEvent, THitOutput> {
    const { plan, hooks } = input;
    const rules = input.rules ?? DEFAULT_COMBAT_RULES;
    assertPlan(plan, rules);

    const initialState = input.state;
    let state = initialState;
    let mutationSequence = 0;
    let eventSequence = 0;
    const scopedMutations: ScopedMutation<TMutation>[] = [];
    const scopedEvents: ScopedEvent<TEvent>[] = [];
    const resolvedHits: HitResolution<THitOutput>[] = [];
    const skippedHits: SkippedHit[] = [];

    const applyCastStep = (phase: CastPhase, step: ReducerStep<TMutation, TEvent> | undefined): void => {
        for (const mutation of step?.mutations ?? []) {
            state = hooks.applyMutation(state, mutation);
            scopedMutations.push(Object.freeze({
                scope: 'cast', phase, sequence: mutationSequence++, mutation,
            }));
        }
        for (const event of step?.events ?? []) {
            scopedEvents.push(Object.freeze({
                scope: 'cast', phase, sequence: eventSequence++, event,
            }));
        }
    };

    const baseContext = (): CastContextBase<TState> => ({ initialState, state, plan, rules });
    applyCastStep('begin', hooks.beginCast?.(baseContext()));

    const targets = plan.kind === 'actors' ? stablePlannedTargetOrder(plan.targets) : [];
    for (let hitIndex = 0; hitIndex < targets.length; hitIndex++) {
        const target = targets[hitIndex]!;
        const casterDefeated = hooks.isActorDefeated?.(state, plan.casterId) ?? false;
        if (casterDefeated && !rules.continueCastAfterCasterDefeat) {
            skippedHits.push(Object.freeze({ hitIndex, targetId: target.actorId, reason: 'caster-defeated' }));
            continue;
        }
        const targetDefeated = hooks.isActorDefeated?.(state, target.actorId) ?? false;
        if (targetDefeated && rules.targetDefeatedDuringCast === 'skip') {
            skippedHits.push(Object.freeze({ hitIndex, targetId: target.actorId, reason: 'target-defeated' }));
            continue;
        }

        const step = hooks.resolveHit({
            ...baseContext(),
            target,
            hitIndex,
            resolvedHits: Object.freeze([...resolvedHits]),
        });
        const hitMutations = step.mutations ?? [];
        const hitEvents = step.events ?? [];
        for (const mutation of hitMutations) {
            state = hooks.applyMutation(state, mutation);
            scopedMutations.push(Object.freeze({
                scope: 'hit', hitIndex, targetId: target.actorId,
                sequence: mutationSequence++, mutation,
            }));
        }
        for (const event of hitEvents) {
            scopedEvents.push(Object.freeze({
                scope: 'hit', hitIndex, targetId: target.actorId,
                sequence: eventSequence++, event,
            }));
        }
        resolvedHits.push(Object.freeze({
            hitIndex,
            targetId: target.actorId,
            mutationCount: hitMutations.length,
            eventCount: hitEvents.length,
            output: step.output,
        }));
    }

    const completeContext: CastCompleteContext<TState, THitOutput> = {
        ...baseContext(),
        resolvedHits: Object.freeze([...resolvedHits]),
        skippedHits: Object.freeze([...skippedHits]),
    };
    applyCastStep('complete', hooks.completeCast?.(completeContext));

    return Object.freeze({
        state,
        plan,
        resolvedHits: Object.freeze(resolvedHits),
        skippedHits: Object.freeze(skippedHits),
        mutations: Object.freeze(scopedMutations),
        events: Object.freeze(scopedEvents),
    });
}
