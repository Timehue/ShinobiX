import { MAX_ACTIONS, SPIRAL_RADIUS } from './constants.js';
import { filledDiskTiles } from './aoe.js';
import { hexDistance, hexNeighbors } from './grid.js';
import { adjustedApCost } from './resources.js';
import { activeCombatStatuses } from './statuses.js';
import type { CombatJutsu, CombatStatus, CombatTag } from './types.js';
import { canonicalTagName, GROUND_EFFECT_TAGS, OPPONENT_AFFECTING_TAGS } from '../pvp/_tags.js';
import { canonicalJutsuMethod, canonicalJutsuTagNames } from './jutsu-vfx.js';

export type JutsuActionRejectionCode =
    | 'cannot-act'
    | 'on-cooldown'
    | 'elementally-sealed'
    | 'no-chakra'
    | 'no-stamina'
    | 'target-tile-required'
    | 'out-of-range'
    | 'invalid-move-target'
    | 'invalid-ground-target'
    | 'ground-effect-needs-supported-tag';

export type JutsuActionBoard = {
    width: number;
    height: number;
    /** Terrain, barriers, companions, and every occupied tile the runtime owns. */
    unavailableTiles: ReadonlySet<number>;
};

export type JutsuActionPlan = {
    accepted: true;
    apCost: number;
    effectiveApCost: number;
    chakraCost: number;
    staminaCost: number;
    cooldown: number;
    method: string;
    range: number;
    tagNames: string[];
    move: boolean;
    pureMove: boolean;
    groundTarget: boolean;
    selfTarget: boolean;
    affectsOpponent: boolean;
    targetTile?: number;
    footprint: number[];
    hitsOpponent: boolean;
    createsGroundEffect: boolean;
    groundTags: CombatTag[];
};

export type ResolveJutsuActionPlanResult =
    | JutsuActionPlan
    | { accepted: false; rejection: JutsuActionRejectionCode };

export type ResolveJutsuActionPlanInput = {
    jutsu: CombatJutsu;
    casterPos: number;
    opponentPos: number;
    casterChakra: number;
    casterStamina: number;
    casterStatuses: readonly CombatStatus[];
    round: number;
    availableAp: number;
    actionsThisTurn: number;
    cooldownRemaining: number;
    tile?: number;
    board: JutsuActionBoard;
    maxActions?: number;
};

const BASIC_ELEMENTS = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);

// Lag / Overclock are flat ±TEMPO_AP_SWING (see combat-core/resources.ts), so
// only PRESENCE matters — the stored percent is never read for either tag, and
// a second stack cannot deepen the swing.
function hasActiveStatus(statuses: readonly CombatStatus[], name: string, round: number): boolean {
    return activeCombatStatuses(statuses, round).some((status) => canonicalTagName(status.name) === name);
}

export function canonicalGroundTags(tags: readonly CombatTag[] | undefined): CombatTag[] {
    return (tags ?? [])
        .map((tag) => ({ ...tag, name: canonicalTagName(tag.name) }))
        .filter((tag) => GROUND_EFFECT_TAGS.has(tag.name));
}

export function resolveJutsuActionPlan(input: ResolveJutsuActionPlanInput): ResolveJutsuActionPlanResult {
    const { jutsu, board } = input;
    const apCost = Math.max(1, Number(jutsu.ap ?? 40));
    const effectiveApCost = adjustedApCost(apCost, {
        lagged: hasActiveStatus(input.casterStatuses, 'Lag', input.round),
        overclocked: hasActiveStatus(input.casterStatuses, 'Overclock', input.round),
    });
    if (input.availableAp < effectiveApCost || input.actionsThisTurn >= (input.maxActions ?? MAX_ACTIONS)) {
        return { accepted: false, rejection: 'cannot-act' };
    }
    if (input.cooldownRemaining > 0) return { accepted: false, rejection: 'on-cooldown' };
    if (jutsu.element && BASIC_ELEMENTS.has(jutsu.element)
        && activeCombatStatuses(input.casterStatuses, input.round).some((status) => canonicalTagName(status.name) === 'Elemental Seal')) {
        return { accepted: false, rejection: 'elementally-sealed' };
    }

    const chakraCost = Math.max(0, Number(jutsu.chakraCost ?? 0));
    const staminaCost = Math.max(0, Number(jutsu.staminaCost ?? 0));
    if (input.casterChakra < chakraCost) return { accepted: false, rejection: 'no-chakra' };
    if (input.casterStamina < staminaCost) return { accepted: false, rejection: 'no-stamina' };

    const tagNames = canonicalJutsuTagNames(jutsu.tags);
    const move = tagNames.includes('Move');
    const pureMove = move && tagNames.every((name) => name === 'Move');
    const groundTarget = jutsu.target === 'EMPTY_GROUND';
    const selfTarget = jutsu.target === 'SELF';
    const affectsOpponent = Number(jutsu.effectPower ?? 0) > 0
        || tagNames.some((name) => OPPONENT_AFFECTING_TAGS.has(name));
    const method = canonicalJutsuMethod(jutsu.method);
    const range = Math.max(move || groundTarget ? 1 : 0, Number(jutsu.range) || (move || groundTarget ? 4 : 0));
    const targetTile = input.tile === undefined ? undefined : Math.floor(input.tile);

    if ((move || groundTarget) && targetTile === undefined) {
        return { accepted: false, rejection: 'target-tile-required' };
    }
    if (!selfTarget && !groundTarget && !move && affectsOpponent && range > 0
        && hexDistance(input.casterPos, input.opponentPos, board.width) > range) {
        return { accepted: false, rejection: 'out-of-range' };
    }
    if (targetTile !== undefined && (move || groundTarget)) {
        const valid = targetTile >= 0
            && targetTile < board.width * board.height
            && hexDistance(input.casterPos, targetTile, board.width) <= range
            && targetTile !== input.casterPos
            && !board.unavailableTiles.has(targetTile);
        if (!valid) return { accepted: false, rejection: move ? 'invalid-move-target' : 'invalid-ground-target' };
    }

    const groundTags = canonicalGroundTags(jutsu.tags);
    // Preserve the live PvP contract: a movement spiral creates a zone, while
    // an ordinary movement cast owns relocation only. Empty-ground instant and
    // spiral casts both create zones.
    const createsGroundEffect = (move && method === 'AOE_SPIRAL')
        || (groundTarget && (method === 'INSTANT_EFFECT' || method === 'AOE_SPIRAL'));
    if (createsGroundEffect && groundTags.length === 0) {
        return { accepted: false, rejection: 'ground-effect-needs-supported-tag' };
    }

    const footprint = targetTile === undefined
        ? []
        : method === 'AOE_SPIRAL'
            ? filledDiskTiles(targetTile, SPIRAL_RADIUS, board.width, board.height)
            : method === 'AOE_CIRCLE' || method === 'INSTANT_EFFECT'
                ? [targetTile, ...hexNeighbors(targetTile, board.width, board.height)]
                : [targetTile];
    const hitsOpponent = targetTile === undefined
        ? !selfTarget && affectsOpponent
        : method === 'AOE_CIRCLE'
            ? footprint.includes(input.opponentPos) && input.opponentPos !== targetTile
            : createsGroundEffect
                ? footprint.includes(input.opponentPos)
                : false;

    return {
        accepted: true,
        apCost,
        effectiveApCost,
        chakraCost,
        staminaCost,
        cooldown: Math.max(0, Math.floor(Number(jutsu.cooldown ?? 0))),
        method,
        range,
        tagNames,
        move,
        pureMove,
        groundTarget,
        selfTarget,
        affectsOpponent,
        ...(targetTile === undefined ? {} : { targetTile }),
        footprint,
        hitsOpponent,
        createsGroundEffect,
        groundTags,
    };
}

export function createCanonicalGroundEffect<TOwner extends string>(input: {
    id: string;
    owner: TOwner;
    name: string;
    plan: JutsuActionPlan;
}): { id: string; owner: TOwner; name: string; tiles: number[]; rounds: number; tags: CombatTag[] } {
    if (!input.plan.createsGroundEffect) throw new Error('Jutsu action plan does not create a ground effect.');
    return {
        id: input.id,
        owner: input.owner,
        name: input.name,
        tiles: [...input.plan.footprint],
        rounds: 2,
        tags: input.plan.groundTags.map((tag) => ({ ...tag })),
    };
}
