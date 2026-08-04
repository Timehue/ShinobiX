/*
 * Runtime-neutral authoritative combat event facts.
 *
 * Engines may keep richer private snapshots, logs, and presentation VFX. This
 * projection is the bounded shared contract for replay, telemetry, clients,
 * and future PvP/Tower adapters: opaque session identity, role-based actors,
 * exact numeric deltas, status/zone changes, item usage, and terminal truth.
 * It deliberately contains no account names, owner slugs, IPs, or character
 * records, and it is display/output evidence only â€” never combat input.
 */

export const AUTHORITATIVE_COMBAT_EVENT_SCHEMA_VERSION = 1 as const;

export type CombatEventActor = 'player' | 'enemy' | 'companion';
export type CombatEventTarget = CombatEventActor | 'tile' | null;

export type CombatEventStatus = {
    name: string;
    kind: 'positive' | 'negative';
    rounds: number;
    activeRound?: number;
    percent?: number;
    amount?: number;
    discipline?: string;
};

export type CombatEventFighterState = {
    hp: number;
    maxHp: number;
    chakra: number;
    stamina: number;
    shield: number;
    pos: number;
    statuses: CombatEventStatus[];
};

export type CombatEventGroundEffect = {
    id: string;
    owner?: string;
    name?: string;
    tiles: number[];
    rounds?: number;
    tags?: Array<{ name: string; percent?: number; amount?: number }>;
};

export type CombatProjectionSnapshot = {
    player: CombatEventFighterState;
    enemy: CombatEventFighterState;
    companion?: CombatEventFighterState;
    ap: { player: number; enemy: number };
    groundEffects: CombatEventGroundEffect[];
    itemCharges: Record<string, number>;
    itemsUsed: Record<string, number>;
};

export type AuthoritativeActorDelta = {
    role: CombatEventActor;
    presentBefore: boolean;
    presentAfter: boolean;
    before?: Omit<CombatEventFighterState, 'statuses'>;
    after?: Omit<CombatEventFighterState, 'statuses'>;
    hpDelta?: number;
    damageToHp?: number;
    healing?: number;
    shieldDelta?: number;
    damageToShield?: number;
    shieldGained?: number;
    chakraDelta?: number;
    staminaDelta?: number;
    movement?: { from: number; to: number };
};

export type CombatResolutionFacts = {
    /** Resolver damage before an encounter-specific ceiling. */
    rawDamage?: number;
    /** Resolver damage after DR and encounter ceilings, before shield/HP routing. */
    resolvedDamage?: number;
    healing?: number;
    shielding?: number;
};

export type CombatObjectiveInteraction = {
    objectiveId: string;
    kind: 'capture' | 'contest' | 'defend' | 'damage' | 'heal' | 'interact' | 'complete';
    amount?: number;
    tile?: number;
};

export type CombatLifecycleFact = {
    role: CombatEventActor;
    event: 'summon' | 'down' | 'revive' | 'dismiss' | 'flee';
};

export type AuthoritativeCombatEvent = {
    schemaVersion: typeof AUTHORITATIVE_COMBAT_EVENT_SCHEMA_VERSION;
    runtime: string;
    mode: string;
    sessionId: string;
    sequence: number | null;
    round: { before: number; after: number };
    actor: CombatEventActor;
    target: CombatEventTarget;
    action: { type: string; id?: string; tile?: number };
    applied: boolean;
    rejectionReason?: string;
    actorSpend: { ap: number; hp: number; chakra: number; stamina: number };
    actors: AuthoritativeActorDelta[];
    damage: Array<{
        source: CombatEventActor;
        target: CombatEventActor;
        raw: number;
        resolved: number;
        toHp: number;
        toShield: number;
        capped: boolean;
    }>;
    healing: Array<{ role: CombatEventActor; raw: number; applied: number }>;
    shielding: Array<{ role: CombatEventActor; raw: number; applied: number }>;
    statusChanges: Array<{
        role: CombatEventActor;
        before: CombatEventStatus[];
        after: CombatEventStatus[];
        applied: CombatEventStatus[];
        removed: CombatEventStatus[];
    }>;
    groundEffects: {
        added: CombatEventGroundEffect[];
        removed: CombatEventGroundEffect[];
        updated: Array<{ before: CombatEventGroundEffect; after: CombatEventGroundEffect }>;
    };
    items: Array<{ id: string; chargeDelta: number; usedDelta: number }>;
    objectives: CombatObjectiveInteraction[];
    lifecycle: CombatLifecycleFact[];
    terminal: {
        status: 'active' | 'done';
        winner: 'player' | 'enemy' | 'draw' | null;
        outcome: 'win' | 'loss' | 'fled' | 'draw' | null;
    };
};

export type ProjectAuthoritativeCombatEventInput = {
    runtime: string;
    mode: string;
    sessionId: string;
    sequence: number | null;
    roundBefore: number;
    roundAfter: number;
    actor: CombatEventActor;
    target: CombatEventTarget;
    actionType: string;
    actionId?: string;
    tile?: number;
    applied: boolean;
    rejectionReason?: string;
    resolution?: CombatResolutionFacts;
    objectives?: CombatObjectiveInteraction[];
    before: CombatProjectionSnapshot;
    after: CombatProjectionSnapshot;
    status: 'active' | 'done';
    winner: 'player' | 'enemy' | 'draw' | null;
    outcome: 'win' | 'loss' | 'fled' | 'draw' | null;
};

const MAX_ABS_NUMBER = 1_000_000_000;
const MAX_STATUS_COUNT = 64;
const MAX_GROUND_EFFECTS = 64;
const MAX_GROUND_TILES = 256;
const MAX_ITEM_FACTS = 64;
const MAX_OBJECTIVE_FACTS = 32;

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

function number(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(-MAX_ABS_NUMBER, Math.min(MAX_ABS_NUMBER, parsed));
}

function tile(value: unknown): number {
    return Math.max(0, Math.min(1_000_000, Math.floor(number(value))));
}

function statuses(value: unknown): CombatEventStatus[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_STATUS_COUNT).flatMap((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const source = raw as Record<string, unknown>;
        const name = text(source.name, 80);
        if (!name) return [];
        return [{
            name,
            kind: source.kind === 'positive' ? 'positive' as const : 'negative' as const,
            rounds: Math.max(0, Math.floor(number(source.rounds))),
            ...(Number.isFinite(Number(source.activeRound)) ? { activeRound: Math.max(0, Math.floor(number(source.activeRound))) } : {}),
            ...(Number.isFinite(Number(source.percent)) ? { percent: number(source.percent) } : {}),
            ...(Number.isFinite(Number(source.amount)) ? { amount: number(source.amount) } : {}),
            ...(typeof source.discipline === 'string' ? { discipline: text(source.discipline, 40) } : {}),
        }];
    });
}

function fighterState(value: CombatEventFighterState): CombatEventFighterState {
    return {
        hp: number(value.hp),
        maxHp: number(value.maxHp),
        chakra: number(value.chakra),
        stamina: number(value.stamina),
        shield: number(value.shield),
        pos: tile(value.pos),
        statuses: statuses(value.statuses),
    };
}

function groundEffects(value: unknown): CombatEventGroundEffect[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_GROUND_EFFECTS).flatMap((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const source = raw as Record<string, unknown>;
        const id = text(source.id, 160);
        if (!id) return [];
        return [{
            id,
            ...(typeof source.owner === 'string' ? { owner: text(source.owner, 24) } : {}),
            ...(typeof source.name === 'string' ? { name: text(source.name, 80) } : {}),
            tiles: Array.isArray(source.tiles) ? source.tiles.slice(0, MAX_GROUND_TILES).map(tile) : [],
            ...(Number.isFinite(Number(source.rounds)) ? { rounds: Math.max(0, Math.floor(number(source.rounds))) } : {}),
            ...(Array.isArray(source.tags) ? {
                tags: source.tags.slice(0, 32).flatMap((rawTag) => {
                    if (!rawTag || typeof rawTag !== 'object' || Array.isArray(rawTag)) return [];
                    const tag = rawTag as Record<string, unknown>;
                    const name = text(tag.name, 80);
                    return name ? [{
                        name,
                        ...(Number.isFinite(Number(tag.percent)) ? { percent: number(tag.percent) } : {}),
                        ...(Number.isFinite(Number(tag.amount)) ? { amount: number(tag.amount) } : {}),
                    }] : [];
                }),
            } : {}),
        }];
    });
}

function publicFighterState(value: CombatEventFighterState): Omit<CombatEventFighterState, 'statuses'> {
    const { statuses: _statuses, ...state } = value;
    return state;
}

function actorDelta(role: CombatEventActor, before: CombatEventFighterState | undefined, after: CombatEventFighterState | undefined): AuthoritativeActorDelta {
    if (!before || !after) {
        return {
            role,
            presentBefore: !!before,
            presentAfter: !!after,
            ...(before ? { before: publicFighterState(before) } : {}),
            ...(after ? { after: publicFighterState(after) } : {}),
        };
    }
    const hpDelta = after.hp - before.hp;
    const shieldDelta = after.shield - before.shield;
    return {
        role,
        presentBefore: true,
        presentAfter: true,
        before: publicFighterState(before),
        after: publicFighterState(after),
        hpDelta,
        damageToHp: Math.max(0, -hpDelta),
        healing: Math.max(0, hpDelta),
        shieldDelta,
        damageToShield: Math.max(0, -shieldDelta),
        shieldGained: Math.max(0, shieldDelta),
        chakraDelta: after.chakra - before.chakra,
        staminaDelta: after.stamina - before.stamina,
        ...(before.pos !== after.pos ? { movement: { from: before.pos, to: after.pos } } : {}),
    };
}

function itemFacts(before: CombatProjectionSnapshot, after: CombatProjectionSnapshot) {
    const ids = [...new Set([
        ...Object.keys(before.itemCharges), ...Object.keys(after.itemCharges),
        ...Object.keys(before.itemsUsed), ...Object.keys(after.itemsUsed),
    ])].sort();
    return ids.slice(0, MAX_ITEM_FACTS).flatMap((id) => {
        const chargeDelta = number(after.itemCharges[id]) - number(before.itemCharges[id]);
        const usedDelta = number(after.itemsUsed[id]) - number(before.itemsUsed[id]);
        return chargeDelta || usedDelta ? [{ id: text(id, 120), chargeDelta, usedDelta }] : [];
    });
}

function statusDifference(first: CombatEventStatus[], second: CombatEventStatus[]): CombatEventStatus[] {
    const remaining = [...first];
    return second.filter((status) => {
        const encoded = JSON.stringify(status);
        const index = remaining.findIndex((candidate) => JSON.stringify(candidate) === encoded);
        if (index < 0) return true;
        remaining.splice(index, 1);
        return false;
    });
}

function objectiveFacts(value: unknown): CombatObjectiveInteraction[] {
    if (!Array.isArray(value)) return [];
    const kinds = new Set<CombatObjectiveInteraction['kind']>(['capture', 'contest', 'defend', 'damage', 'heal', 'interact', 'complete']);
    return value.slice(0, MAX_OBJECTIVE_FACTS).flatMap((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const source = raw as Record<string, unknown>;
        const objectiveId = text(source.objectiveId, 120);
        if (!objectiveId || typeof source.kind !== 'string' || !kinds.has(source.kind as CombatObjectiveInteraction['kind'])) return [];
        return [{
            objectiveId,
            kind: source.kind as CombatObjectiveInteraction['kind'],
            ...(Number.isFinite(Number(source.amount)) ? { amount: number(source.amount) } : {}),
            ...(Number.isFinite(Number(source.tile)) ? { tile: tile(source.tile) } : {}),
        }];
    });
}

export function projectAuthoritativeCombatEvent(input: ProjectAuthoritativeCombatEventInput): AuthoritativeCombatEvent {
    const before = {
        player: fighterState(input.before.player),
        enemy: fighterState(input.before.enemy),
        ...(input.before.companion ? { companion: fighterState(input.before.companion) } : {}),
    };
    const after = {
        player: fighterState(input.after.player),
        enemy: fighterState(input.after.enemy),
        ...(input.after.companion ? { companion: fighterState(input.after.companion) } : {}),
    };
    const roles: CombatEventActor[] = ['player', 'enemy', 'companion'];
    const beforeZones = groundEffects(input.before.groundEffects);
    const afterZones = groundEffects(input.after.groundEffects);
    const beforeZoneMap = new Map(beforeZones.map((effect) => [effect.id, effect]));
    const afterZoneMap = new Map(afterZones.map((effect) => [effect.id, effect]));
    const actorBefore = before[input.actor];
    const actorAfter = after[input.actor];
    const actorDeltas = roles
        .filter((role) => before[role] || after[role])
        .map((role) => actorDelta(role, before[role], after[role]));
    const resolution = input.resolution ?? {};
    const primaryTarget = input.target === 'player' || input.target === 'enemy' || input.target === 'companion'
        ? input.target
        : null;
    const damage = actorDeltas.flatMap((delta) => {
        const toHp = delta.damageToHp ?? 0;
        const toShield = delta.damageToShield ?? 0;
        const observed = toHp + toShield;
        const isPrimary = delta.role === primaryTarget;
        const resolved = isPrimary && Number.isFinite(Number(resolution.resolvedDamage))
            ? Math.max(0, number(resolution.resolvedDamage))
            : observed;
        const raw = isPrimary && Number.isFinite(Number(resolution.rawDamage))
            ? Math.max(0, number(resolution.rawDamage))
            : resolved;
        return raw > 0 || resolved > 0 || observed > 0 ? [{
            source: input.actor,
            target: delta.role,
            raw,
            resolved,
            toHp,
            toShield,
            capped: raw > resolved,
        }] : [];
    });
    const healing = actorDeltas.flatMap((delta) => {
        const applied = delta.healing ?? 0;
        const raw = delta.role === input.actor && Number.isFinite(Number(resolution.healing))
            ? Math.max(0, number(resolution.healing))
            : applied;
        return raw > 0 || applied > 0 ? [{ role: delta.role, raw, applied }] : [];
    });
    const shielding = actorDeltas.flatMap((delta) => {
        const applied = delta.shieldGained ?? 0;
        const raw = delta.role === input.actor && Number.isFinite(Number(resolution.shielding))
            ? Math.max(0, number(resolution.shielding))
            : applied;
        return raw > 0 || applied > 0 ? [{ role: delta.role, raw, applied }] : [];
    });
    const lifecycle: CombatLifecycleFact[] = [];
    for (const role of roles) {
        const first = before[role];
        const second = after[role];
        if (!first && second) {
            lifecycle.push({ role, event: 'summon' });
            continue;
        }
        if (first && !second) {
            const dismissed = role === 'companion' && input.actionId === 'Phase End';
            lifecycle.push({ role, event: dismissed ? 'dismiss' : 'down' });
            continue;
        }
        if (first && second && first.hp > 0 && second.hp <= 0) lifecycle.push({ role, event: 'down' });
        if (first && second && first.hp <= 0 && second.hp > 0) lifecycle.push({ role, event: 'revive' });
    }
    if (input.outcome === 'fled') lifecycle.push({ role: input.actor, event: 'flee' });

    return {
        schemaVersion: AUTHORITATIVE_COMBAT_EVENT_SCHEMA_VERSION,
        runtime: text(input.runtime, 40),
        mode: text(input.mode, 64),
        sessionId: text(input.sessionId, 128),
        sequence: input.sequence === null ? null : Math.max(0, Math.floor(number(input.sequence))),
        round: {
            before: Math.max(0, Math.floor(number(input.roundBefore))),
            after: Math.max(0, Math.floor(number(input.roundAfter))),
        },
        actor: input.actor,
        target: input.target,
        action: {
            type: text(input.actionType, 64),
            ...(input.actionId ? { id: text(input.actionId, 120) } : {}),
            ...(input.tile === undefined ? {} : { tile: tile(input.tile) }),
        },
        applied: input.applied,
        ...(!input.applied ? { rejectionReason: text(input.rejectionReason || 'rejected', 80) } : {}),
        actorSpend: {
            ap: Math.max(0, number(input.before.ap[input.actor === 'enemy' ? 'enemy' : 'player']) - number(input.after.ap[input.actor === 'enemy' ? 'enemy' : 'player'])),
            hp: actorBefore && actorAfter ? Math.max(0, actorBefore.hp - actorAfter.hp) : 0,
            chakra: actorBefore && actorAfter ? Math.max(0, actorBefore.chakra - actorAfter.chakra) : 0,
            stamina: actorBefore && actorAfter ? Math.max(0, actorBefore.stamina - actorAfter.stamina) : 0,
        },
        actors: actorDeltas,
        damage,
        healing,
        shielding,
        statusChanges: roles.flatMap((role) => {
            const first = before[role]?.statuses ?? [];
            const second = after[role]?.statuses ?? [];
            return JSON.stringify(first) === JSON.stringify(second) ? [] : [{
                role,
                before: first,
                after: second,
                applied: statusDifference(first, second),
                removed: statusDifference(second, first),
            }];
        }),
        groundEffects: {
            added: afterZones.filter((effect) => !beforeZoneMap.has(effect.id)),
            removed: beforeZones.filter((effect) => !afterZoneMap.has(effect.id)),
            updated: afterZones.flatMap((effect) => {
                const previous = beforeZoneMap.get(effect.id);
                return previous && JSON.stringify(previous) !== JSON.stringify(effect) ? [{ before: previous, after: effect }] : [];
            }),
        },
        items: itemFacts(input.before, input.after),
        objectives: objectiveFacts(input.objectives),
        lifecycle,
        terminal: { status: input.status, winner: input.winner, outcome: input.outcome },
    };
}
