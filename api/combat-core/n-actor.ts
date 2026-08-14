/**
 * Canonical N-actor combat vocabulary.
 *
 * This module is deliberately additive: Battle Towers now uses it for canonical
 * multi-target planning while current PvP and Solo PvE remain on their shipped
 * adapters. It gives every runtime one stable authority boundary without changing
 * existing two-actor combat results.
 *
 * The important split is:
 *   ActionIntent  - what one controller asked one actor to do;
 *   TargetPlan    - the server-derived, ordered set of things the action hits.
 *
 * Clients may choose an anchor actor/tile.  They never author the expanded
 * target list or its order.
 */

declare const ACTOR_ID: unique symbol;
declare const TEAM_ID: unique symbol;
declare const CONTROLLER_ID: unique symbol;

export type ActorId = string & { readonly [ACTOR_ID]: 'ActorId' };
export type TeamId = string & { readonly [TEAM_ID]: 'TeamId' };
export type ControllerId = string & { readonly [CONTROLLER_ID]: 'ControllerId' };

function opaqueId<T extends string>(value: string, label: string): T {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string.`);
    }
    return value as T;
}

export const actorId = (value: string): ActorId => opaqueId<ActorId>(value, 'ActorId');
export const teamId = (value: string): TeamId => opaqueId<TeamId>(value, 'TeamId');
export const controllerId = (value: string): ControllerId => opaqueId<ControllerId>(value, 'ControllerId');

export type CombatActorState = 'active' | 'defeated' | 'removed';

/** Immutable identity/order facts. Mutable HP/resources belong to an adapter's state. */
export type CombatActorRef = Readonly<{
    actorId: ActorId;
    teamId: TeamId;
    controllerId: ControllerId;
    /** Server-minted spawn/roster ordinal. Array position is never authoritative. */
    rosterOrder: number;
    state?: CombatActorState;
}>;

export type Viewer = Readonly<{
    teamId: TeamId;
    actorId?: ActorId;
    controllerId?: ControllerId;
}>;

/** Relative to a viewer, not an intrinsic property of the target actor. */
export type ViewerRelation = 'self' | 'ally' | 'enemy' | 'neutral';
export type TeamRelation = Exclude<ViewerRelation, 'self'>;

export type CombatRules = Readonly<{
    /** Same-team actors are always allies; this policy is consulted across teams. */
    relationBetweenTeams: (viewerTeamId: TeamId, targetTeamId: TeamId) => TeamRelation;
    /** Optional mode-level veto for stealth, phases, summons, protected NPCs, etc. */
    canTargetActor: (input: Readonly<{
        caster: CombatActorRef;
        target: CombatActorRef;
        relation: ViewerRelation;
    }>) => boolean;
    /** Structural denial-of-service / malformed-content guard, not an ability balance value. */
    maxTargetsPerCast: number;
    /** A committed cast normally resolves atomically even if a reaction defeats its caster. */
    continueCastAfterCasterDefeat: boolean;
    /** A target defeated by an earlier reaction in the same cast is normally skipped. */
    targetDefeatedDuringCast: 'resolve' | 'skip';
}>;

const DEFAULT_RELATION_BETWEEN_TEAMS: CombatRules['relationBetweenTeams'] = () => 'enemy';
const DEFAULT_CAN_TARGET_ACTOR: CombatRules['canTargetActor'] = () => true;

export const DEFAULT_COMBAT_RULES: CombatRules = Object.freeze({
    relationBetweenTeams: DEFAULT_RELATION_BETWEEN_TEAMS,
    canTargetActor: DEFAULT_CAN_TARGET_ACTOR,
    maxTargetsPerCast: 64,
    continueCastAfterCasterDefeat: true,
    targetDefeatedDuringCast: 'skip',
});

export function createCombatRules(overrides: Partial<CombatRules> = {}): CombatRules {
    const maxTargetsPerCast = overrides.maxTargetsPerCast ?? DEFAULT_COMBAT_RULES.maxTargetsPerCast;
    if (!Number.isSafeInteger(maxTargetsPerCast) || maxTargetsPerCast < 1) {
        throw new RangeError('CombatRules.maxTargetsPerCast must be a positive safe integer.');
    }
    return Object.freeze({ ...DEFAULT_COMBAT_RULES, ...overrides, maxTargetsPerCast });
}

export function viewerRelation(
    viewer: Viewer,
    target: CombatActorRef,
    rules: CombatRules = DEFAULT_COMBAT_RULES,
): ViewerRelation {
    if (viewer.actorId !== undefined && viewer.actorId === target.actorId) return 'self';
    if (viewer.teamId === target.teamId) return 'ally';
    return rules.relationBetweenTeams(viewer.teamId, target.teamId);
}

export function relationFromActor(
    viewerActor: CombatActorRef,
    target: CombatActorRef,
    rules: CombatRules = DEFAULT_COMBAT_RULES,
): ViewerRelation {
    return viewerRelation({
        actorId: viewerActor.actorId,
        teamId: viewerActor.teamId,
        controllerId: viewerActor.controllerId,
    }, target, rules);
}

function compareOpaqueIds(a: ActorId, b: ActorId): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical order is independent of object/array insertion order and locale.
 * Duplicate roster ordinals are legal during migrations; ActorId is the total-order tie break.
 */
export function compareStableActorOrder(a: CombatActorRef, b: CombatActorRef): number {
    const byOrder = a.rosterOrder - b.rosterOrder;
    return byOrder || compareOpaqueIds(a.actorId, b.actorId);
}

export function stableActorOrder(actors: readonly CombatActorRef[]): CombatActorRef[] {
    return [...actors].sort(compareStableActorOrder);
}

const RELATION_ORDER: Readonly<Record<ViewerRelation, number>> = Object.freeze({
    self: 0,
    ally: 1,
    enemy: 2,
    neutral: 3,
});

export type ActorTargetRuleInput = Readonly<{
    kind: 'actor';
    relations: readonly ViewerRelation[];
    minTargets?: number;
    maxTargets?: number | 'all';
    primary?: 'required' | 'optional' | 'none';
    includeDefeated?: boolean;
}>;

export type TileTargetRuleInput = Readonly<{
    kind: 'tile';
    occupancy?: 'any' | 'empty' | 'occupied';
}>;

export type AbilityTargetRuleInput =
    | string
    | ActorTargetRuleInput
    | TileTargetRuleInput
    | Readonly<{ kind: 'none' }>
    | null
    | undefined;

export type NormalizedActorTargetRule = Readonly<{
    kind: 'actor';
    relations: readonly ViewerRelation[];
    minTargets: number;
    maxTargets: number | 'all';
    primary: 'required' | 'optional' | 'none';
    includeDefeated: boolean;
}>;

export type NormalizedAbilityTargetRule =
    | NormalizedActorTargetRule
    | Readonly<{ kind: 'tile'; occupancy: 'any' | 'empty' | 'occupied' }>
    | Readonly<{ kind: 'none' }>;

function canonicalRelations(relations: readonly ViewerRelation[]): ViewerRelation[] {
    const valid = new Set<ViewerRelation>(['self', 'ally', 'enemy', 'neutral']);
    if (relations.some((relation) => !valid.has(relation))) {
        throw new TypeError('Ability actor target rule contains an unknown relation.');
    }
    return [...new Set(relations)].sort((a, b) => RELATION_ORDER[a] - RELATION_ORDER[b]);
}

function naturalTargetCount(value: number | undefined, fallback: number, label: string): number {
    const count = value ?? fallback;
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer.`);
    }
    return count;
}

function actorRule(
    relations: readonly ViewerRelation[],
    options: Omit<ActorTargetRuleInput, 'kind' | 'relations'> = {},
): NormalizedActorTargetRule {
    const canonical = canonicalRelations(relations);
    if (canonical.length === 0) throw new TypeError('Ability actor target rule needs at least one relation.');
    const primary = options.primary ?? 'required';
    const minTargets = naturalTargetCount(options.minTargets, primary === 'required' ? 1 : 0, 'minTargets');
    const maxTargets = options.maxTargets === 'all'
        ? 'all'
        : naturalTargetCount(options.maxTargets, 1, 'maxTargets');
    if (maxTargets !== 'all' && minTargets > maxTargets) {
        throw new RangeError('minTargets cannot exceed maxTargets.');
    }
    if (primary === 'required' && minTargets < 1) {
        throw new RangeError('A required primary target needs minTargets >= 1.');
    }
    return Object.freeze({
        kind: 'actor' as const,
        relations: Object.freeze(canonical),
        minTargets,
        maxTargets,
        primary,
        includeDefeated: options.includeDefeated ?? false,
    });
}

/**
 * Normalize legacy target labels at the adapter boundary. Spatial/AOE expansion is deliberately
 * not inferred here: an adapter supplies the actors in the authoritative footprint to the planner.
 */
export function normalizeAbilityTargetRule(input: AbilityTargetRuleInput): NormalizedAbilityTargetRule {
    if (input === null || input === undefined) return actorRule(['enemy']);
    if (typeof input !== 'string') {
        if (input.kind === 'none') return Object.freeze({ kind: 'none' as const });
        if (input.kind === 'tile') {
            return Object.freeze({ kind: 'tile' as const, occupancy: input.occupancy ?? 'any' });
        }
        return actorRule(input.relations, input);
    }

    const token = input.trim().toUpperCase().replace(/[ -]+/g, '_');
    switch (token) {
        case 'NONE':
        case 'NO_TARGET':
            return Object.freeze({ kind: 'none' as const });
        case 'SELF':
            return actorRule(['self']);
        case 'ALLY':
        case 'FRIENDLY':
            return actorRule(['ally']);
        case 'ALLY_OR_SELF':
        case 'FRIENDLY_OR_SELF':
            return actorRule(['self', 'ally']);
        case 'OPPONENT':
        case 'ENEMY':
        case 'HOSTILE':
            return actorRule(['enemy']);
        case 'ACTOR':
        case 'ANY_ACTOR':
            return actorRule(['self', 'ally', 'enemy', 'neutral']);
        case 'EMPTY_GROUND':
            return Object.freeze({ kind: 'tile' as const, occupancy: 'empty' as const });
        case 'OCCUPIED_TILE':
            return Object.freeze({ kind: 'tile' as const, occupancy: 'occupied' as const });
        case 'GROUND':
        case 'TILE':
            return Object.freeze({ kind: 'tile' as const, occupancy: 'any' as const });
        default:
            throw new TypeError(`Unknown ability target rule: ${input}`);
    }
}

export type ActionTargetIntent =
    | Readonly<{ kind: 'actor'; actorId: ActorId }>
    | Readonly<{ kind: 'tile'; tile: number }>;

type IntentAuthority = Readonly<{
    actorId: ActorId;
    controllerId: ControllerId;
}>;

export type ActionIntent =
    | (IntentAuthority & Readonly<{ type: 'wait' }>)
    | (IntentAuthority & Readonly<{ type: 'move'; tile: number }>)
    | (IntentAuthority & Readonly<{ type: 'basic-attack'; target: Readonly<{ kind: 'actor'; actorId: ActorId }> }>)
    | (IntentAuthority & Readonly<{ type: 'ability'; abilityId: string; target?: ActionTargetIntent }>)
    | (IntentAuthority & Readonly<{ type: 'item'; itemId: string; target?: ActionTargetIntent }>);

export type PlannedActorTarget = Readonly<{
    actorId: ActorId;
    teamId: TeamId;
    relation: ViewerRelation;
    rosterOrder: number;
    primary: boolean;
}>;

type TargetPlanBase = Readonly<{
    casterId: ActorId;
    controllerId: ControllerId;
    abilityId: string;
}>;

export type TargetPlan =
    | (TargetPlanBase & Readonly<{
        kind: 'actors';
        rule: NormalizedActorTargetRule;
        primaryTargetId?: ActorId;
        targets: readonly PlannedActorTarget[];
    }>)
    | (TargetPlanBase & Readonly<{
        kind: 'tile';
        rule: Extract<NormalizedAbilityTargetRule, { kind: 'tile' }>;
        tile: number;
        targets: readonly [];
    }>)
    | (TargetPlanBase & Readonly<{
        kind: 'none';
        rule: Extract<NormalizedAbilityTargetRule, { kind: 'none' }>;
        targets: readonly [];
    }>);

export type TargetPlanRejection =
    | 'not-an-ability-intent'
    | 'unknown-caster'
    | 'duplicate-actor-id'
    | 'invalid-roster-order'
    | 'controller-mismatch'
    | 'target-kind-mismatch'
    | 'invalid-tile'
    | 'unknown-primary-target'
    | 'primary-target-not-allowed'
    | 'unknown-expanded-target'
    | 'insufficient-targets'
    | 'too-many-targets';

export type TargetPlanResult =
    | Readonly<{ accepted: true; plan: TargetPlan }>
    | Readonly<{ accepted: false; rejection: TargetPlanRejection }>;

const EMPTY_TARGETS: readonly [] = Object.freeze([]) as readonly [];

export type PlanAbilityTargetsInput = Readonly<{
    intent: ActionIntent;
    rule: NormalizedAbilityTargetRule;
    roster: readonly CombatActorRef[];
    /** Server-derived actors in an AOE/chain/cone footprint; never client authority. */
    expandedActorIds?: readonly ActorId[];
    rules?: CombatRules;
}>;

function actorState(actor: CombatActorRef): CombatActorState {
    return actor.state ?? 'active';
}

function plannedTarget(actor: CombatActorRef, relation: ViewerRelation, primaryTargetId?: ActorId): PlannedActorTarget {
    return Object.freeze({
        actorId: actor.actorId,
        teamId: actor.teamId,
        relation,
        rosterOrder: actor.rosterOrder,
        primary: actor.actorId === primaryTargetId,
    });
}

export function comparePlannedTargetOrder(a: PlannedActorTarget, b: PlannedActorTarget): number {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    const byOrder = a.rosterOrder - b.rosterOrder;
    return byOrder || compareOpaqueIds(a.actorId, b.actorId);
}

export function stablePlannedTargetOrder(targets: readonly PlannedActorTarget[]): PlannedActorTarget[] {
    return [...targets].sort(comparePlannedTargetOrder);
}

function validateRoster(roster: readonly CombatActorRef[]): TargetPlanRejection | null {
    const ids = new Set<ActorId>();
    for (const actor of roster) {
        if (ids.has(actor.actorId)) return 'duplicate-actor-id';
        ids.add(actor.actorId);
        if (!Number.isSafeInteger(actor.rosterOrder) || actor.rosterOrder < 0) return 'invalid-roster-order';
    }
    return null;
}

/** Resolve controller authority, relation eligibility, and deterministic N-target order. */
export function planAbilityTargets(input: PlanAbilityTargetsInput): TargetPlanResult {
    const { intent, rule, roster } = input;
    if (intent.type !== 'ability') return { accepted: false, rejection: 'not-an-ability-intent' };
    const rosterError = validateRoster(roster);
    if (rosterError) return { accepted: false, rejection: rosterError };

    const byId = new Map(roster.map((actor) => [actor.actorId, actor] as const));
    const caster = byId.get(intent.actorId);
    if (!caster) return { accepted: false, rejection: 'unknown-caster' };
    if (caster.controllerId !== intent.controllerId) return { accepted: false, rejection: 'controller-mismatch' };

    const rules = input.rules ?? DEFAULT_COMBAT_RULES;
    const base = {
        casterId: caster.actorId,
        controllerId: caster.controllerId,
        abilityId: intent.abilityId,
    } as const;

    if (rule.kind === 'none') {
        if (intent.target !== undefined) return { accepted: false, rejection: 'target-kind-mismatch' };
        return { accepted: true, plan: Object.freeze({ ...base, kind: 'none', rule, targets: EMPTY_TARGETS }) };
    }

    if (rule.kind === 'tile') {
        if (intent.target?.kind !== 'tile') return { accepted: false, rejection: 'target-kind-mismatch' };
        if (!Number.isSafeInteger(intent.target.tile) || intent.target.tile < 0) {
            return { accepted: false, rejection: 'invalid-tile' };
        }
        return {
            accepted: true,
            plan: Object.freeze({ ...base, kind: 'tile', rule, tile: intent.target.tile, targets: EMPTY_TARGETS }),
        };
    }

    if (intent.target !== undefined && intent.target.kind !== 'actor') {
        return { accepted: false, rejection: 'target-kind-mismatch' };
    }
    const primaryTargetId = intent.target?.actorId;
    if (rule.primary === 'required' && primaryTargetId === undefined) {
        return { accepted: false, rejection: 'target-kind-mismatch' };
    }
    if (rule.primary === 'none' && primaryTargetId !== undefined) {
        return { accepted: false, rejection: 'target-kind-mismatch' };
    }

    const relationFor = (actor: CombatActorRef) => relationFromActor(caster, actor, rules);
    const allowed = (actor: CombatActorRef): boolean => {
        const relation = relationFor(actor);
        if (!rule.relations.includes(relation)) return false;
        const state = actorState(actor);
        if (state === 'removed' || (state === 'defeated' && !rule.includeDefeated)) return false;
        return rules.canTargetActor({ caster, target: actor, relation });
    };

    if (primaryTargetId !== undefined) {
        const primary = byId.get(primaryTargetId);
        if (!primary) return { accepted: false, rejection: 'unknown-primary-target' };
        if (!allowed(primary)) return { accepted: false, rejection: 'primary-target-not-allowed' };
    }

    const expanded = input.expandedActorIds
        ?? (primaryTargetId !== undefined ? [primaryTargetId] : roster.map((actor) => actor.actorId));
    const candidateIds = primaryTargetId === undefined || expanded.includes(primaryTargetId)
        ? expanded
        : [primaryTargetId, ...expanded];
    const uniqueIds: ActorId[] = [];
    const seen = new Set<ActorId>();
    for (const id of candidateIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!byId.has(id)) return { accepted: false, rejection: 'unknown-expanded-target' };
        uniqueIds.push(id);
    }

    let targets = uniqueIds
        .map((id) => byId.get(id)!)
        .filter(allowed)
        .map((actor) => plannedTarget(actor, relationFor(actor), primaryTargetId));
    targets = stablePlannedTargetOrder(targets);

    if (rule.maxTargets !== 'all') targets = targets.slice(0, rule.maxTargets);
    if (targets.length > rules.maxTargetsPerCast) {
        return { accepted: false, rejection: 'too-many-targets' };
    }
    if (targets.length < rule.minTargets) return { accepted: false, rejection: 'insufficient-targets' };

    return {
        accepted: true,
        plan: Object.freeze({
            ...base,
            kind: 'actors' as const,
            rule,
            ...(primaryTargetId !== undefined ? { primaryTargetId } : {}),
            targets: Object.freeze(targets),
        }),
    };
}
