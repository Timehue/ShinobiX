import { canonicalJutsuMethod, canonicalJutsuTagNames } from './jutsu-vfx.js';
import { hexDistance } from './grid.js';
import { isZeroDamageFortyApJutsu } from './formulas.js';
import type { CombatTag } from './types.js';

type MovementJutsu = {
    id?: string; name?: string; cooldown?: number; ap?: number; isUtility?: boolean; method?: string;
    effectPower?: number; range?: number; target?: string; tags?: unknown[];
};

/** The existing resolver deals immediate damage in the landing ring. Pure
 * Flicker and utility movement must not be mistaken for damaging approaches. */
export function isDamagingAiGapCloser(jutsu: MovementJutsu): boolean {
    const tags = jutsu.tags?.filter((tag): tag is CombatTag => !!tag && typeof tag === 'object'
        && typeof (tag as { name?: unknown }).name === 'string');
    return canonicalJutsuTagNames(tags).includes('Move')
        && canonicalJutsuMethod(jutsu.method) === 'AOE_CIRCLE'
        && Number(jutsu.effectPower) > 0
        && !isZeroDamageFortyApJutsu({ ...jutsu, id: jutsu.id ?? '' });
}

/** A non-adjacent NPC may strike while approaching during the opening rounds.
 * This is an AI choice exception; damage caps and every cast cost stay intact. */
export function isDistantAiGapCloser(jutsu: MovementJutsu, distance: number): boolean {
    return distance > 1 && isDamagingAiGapCloser(jutsu);
}

/** Story identities rename their techniques. The sealed built-in ID remains
 * authoritative even when Flicker's displayed name is a themed step. */
export function isAiFlicker(jutsu: MovementJutsu): boolean {
    return (jutsu.id === 'starter-universal-flicker' || /^flicker$/i.test(String(jutsu.name ?? '').trim()))
        && !!jutsu.tags?.some(tag => !!tag && typeof tag === 'object' && (tag as {name?:unknown}).name === 'Move')
        && !isDamagingAiGapCloser(jutsu);
}

/** NPCs with damaging dashes save their AP for those skills within six hexes,
 * even while the skill is unavailable. Other legal actions may still be used. */
export function prefersAiGapClosingMovement(kit: readonly MovementJutsu[], distance: number): boolean {
    return distance <= 6 && kit.some(j => isDamagingAiGapCloser(j) || isAiFlicker(j));
}

/** Cooldowns tick at turn start, so a full Flicker cooldown plus a paid action
 * identifies a move made this turn, without a new persisted combat flag. */
export function aiJustFlickered(kit: readonly MovementJutsu[], cooldowns: Record<string, number>, actions: number): boolean {
    return actions > 0 && kit.some(j => isAiFlicker(j) && j.id
        && Number(j.cooldown) > 0 && Number(cooldowns[j.id]) >= Number(j.cooldown));
}

/** Callers supply ready, affordable follow-ups. Enter their real attack range;
 * fall back to melee reach when only a basic attack can follow Flicker. */
export function aiRangedAttackReach(kit: readonly MovementJutsu[]): number {
    return Math.max(1, ...kit.filter(j => j.target !== 'SELF' && Number(j.effectPower) > 0
        && !isZeroDamageFortyApJutsu({ ...j, id: j.id ?? '' })
        && !j.tags?.some(tag => !!tag && typeof tag === 'object' && (tag as { name?: unknown }).name === 'Move'))
        .map(j => Math.max(1, Number(j.range) || 1)));
}

export function aiApproachLandingTile(input: {
    range: number; reach: number; from: number; target: number; width: number; height: number;
    blocked: (tile: number) => boolean;
}): number | undefined {
    if (hexDistance(input.from, input.target, input.width) <= input.reach) return undefined;
    return Array.from({ length: input.width * input.height }, (_, tile) => tile)
        .filter(tile => tile !== input.from && tile !== input.target && !input.blocked(tile)
            && hexDistance(input.from, tile, input.width) <= input.range
            && hexDistance(tile, input.target, input.width) <= input.reach)
        .sort((a,b) => hexDistance(b,input.target,input.width)-hexDistance(a,input.target,input.width)
            || hexDistance(a,input.from,input.width)-hexDistance(b,input.from,input.width) || a-b)[0];
}

/** Prefer a landing ring that hits. Within six hexes, use the dash itself to
 * approach when no impact is in range. The caller checks cast eligibility. */
export function aiGapCloserLandingTile(input: {
    jutsu: MovementJutsu; from: number; target: number; width: number; height: number;
    blocked: (tile: number) => boolean;
}): number | undefined {
    if (!isDamagingAiGapCloser(input.jutsu)) return undefined;
    const range = Math.max(1, Number(input.jutsu.range) || 4);
    const distance = hexDistance(input.from, input.target, input.width);
    const tiles = Array.from({ length: input.width * input.height }, (_, tile) => tile)
        .filter(tile => tile !== input.from && tile !== input.target && !input.blocked(tile)
            && hexDistance(input.from, tile, input.width) <= range);
    const impact = tiles.filter(tile => hexDistance(tile, input.target, input.width) === 1)
        .sort((a, b) => hexDistance(input.from, a, input.width) - hexDistance(input.from, b, input.width) || a - b)[0];
    if (impact !== undefined) return impact;
    return distance <= 6 ? tiles.filter(tile => hexDistance(tile, input.target, input.width) < distance)
        .sort((a, b) => hexDistance(a, input.target, input.width) - hexDistance(b, input.target, input.width) || a - b)[0] : undefined;
}
