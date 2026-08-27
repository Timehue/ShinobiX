/*
 * Canonical server schema for PLAYER-AUTHORED bloodline jutsu.
 *
 * The Bloodline Maker exposes a deliberately small set of structural choices.
 * Persisting a spread of the incoming object turns every omitted UI control into
 * an accidental combat API, so both save ingress and PvP session sealing run
 * player content through this module. Built-in and admin-authored definitions do
 * not use this path.
 */

import { bloodlinePoints, enforceBloodlineBudget, type RawJutsu } from '../_jutsu-points.js';
import { sanitizeJutsuVisualEffect } from '../_jutsu-visuals.js';
import {
    canonicalTagName,
    FIXED_EFFECT_POWER_TAGS,
    GROUND_EFFECT_TAGS,
    OPPONENT_AFFECTING_TAGS,
    REQUIRES_DAMAGE_TAGS,
} from '../pvp/_tags.js';

type Json = Record<string, unknown>;
export type NormalizedPlayerBloodlineJutsu = Omit<RawJutsu, 'tags'> & Json & {
    tags: Array<{ name: string; percent: number }>;
};

const PLAYER_JUTSU_METHODS = new Set(['SINGLE', 'AOE_CIRCLE', 'INSTANT_EFFECT', 'AOE_SPIRAL', 'AOE_BURST']);
const PLAYER_JUTSU_TYPES = new Set(['Any', 'Ninjutsu', 'Taijutsu', 'Bukijutsu', 'Genjutsu']);
const PLAYER_WEATHER_ELEMENTS = new Set(['None', 'Fire', 'Water', 'Wind', 'Earth', 'Lightning']);

// Mirrors shinobij.client/src/lib/tags.ts allTags, plus Pierce (selected by the
// maker's damage-mode control rather than its tag picker).
const PLAYER_BLOODLINE_TAGS = new Set([
    'Absorb', 'Buff Prevent', 'Cleanse Prevent', 'Clear Prevent', 'Copy',
    'Debuff Prevent', 'Decrease Damage Given', 'Decrease Damage Taken', 'Drain',
    'Elemental Seal', 'Heal', 'Ignition', 'Increase Damage Given',
    'Increase Damage Taken', 'Increase Generals', 'Increase Heal', 'Lifesteal',
    'Mirror', 'Move', 'Poison', 'Pull', 'Push', 'Recoil', 'Reflect',
    'Bloodline Seal', 'Shield', 'Siphon', 'Stun', 'Stun Prevent', 'Lag',
    'Overclock', 'Wound', 'Pierce',
]);

const BINARY_TAGS = new Set([
    'Stun', 'Bloodline Seal', 'Elemental Seal', 'Copy', 'Mirror', 'Move',
    'Buff Prevent', 'Debuff Prevent', 'Cleanse Prevent', 'Clear Prevent',
    'Stun Prevent', 'Lag', 'Overclock', 'Pierce',
]);

// Magnitude is fixed by the live resolver for these effects.
const FIXED_MAGNITUDE_TAGS = new Set(['Heal', 'Shield', 'Drain', 'Push', 'Pull']);
const BLOODLINE_UNIQUE_TAGS = new Set([
    'Stun', 'Bloodline Seal', 'Buff Prevent', 'Debuff Prevent', 'Elemental Seal',
    'Mirror', 'Copy', 'Lag', 'Overclock', 'Pierce',
]);
const FORTY_AP_BLOCKED_TAGS = new Set(['Pierce', 'Siphon', 'Mirror', 'Copy', 'Wound']);

function rankJutsuCount(rank: string | null | undefined): number {
    return rank === 'B Rank' ? 4 : 5;
}

function rankCreatorPercentChoices(rank: string | null | undefined): readonly number[] {
    return rank === 'S Rank' ? [30, 35] : [25, 30];
}

function creatorPercent(value: unknown, rank: string | null | undefined): number {
    const choices = rankCreatorPercentChoices(rank);
    const n = Number(value);
    return choices.includes(n) ? n : choices[choices.length - 1]!;
}

function safeText(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.slice(0, max);
}

function normalizeTags(
    raw: unknown,
    rank: string | null | undefined,
    ap: 40 | 60 | 80,
    method: string,
    usedBloodlineUniqueTags: Set<string>,
): Array<{ name: string; percent: number }> {
    const maxTags = ap === 40 ? 3 : 2;
    let candidates = (Array.isArray(raw) ? raw : [])
        .filter((tag): tag is Json => !!tag && typeof tag === 'object' && !Array.isArray(tag))
        .map((tag) => ({
            name: canonicalTagName(String(tag.name ?? '')),
            percent: tag.percent,
        }))
        .filter((tag) => PLAYER_BLOODLINE_TAGS.has(tag.name));

    if (method === 'INSTANT_EFFECT') {
        candidates = candidates.filter((tag) => GROUND_EFFECT_TAGS.has(tag.name));
    } else if (method === 'AOE_SPIRAL') {
        candidates = [
            { name: 'Move', percent: 0 },
            ...candidates.filter((tag) => tag.name !== 'Move' && GROUND_EFFECT_TAGS.has(tag.name)),
        ];
    } else if (method === 'AOE_CIRCLE') {
        candidates = [{ name: 'Move', percent: 0 }, ...candidates.filter((tag) => tag.name !== 'Move')];
    } else if (method === 'AOE_BURST') {
        // A burst is opponent-centred. The live action planner gives Move
        // precedence and turns the same definition into tile-targeted
        // relocation, so player-authored bursts cannot carry Move.
        candidates = candidates.filter((tag) => tag.name !== 'Move');
    }

    // SINGLE Move has no impact footprint: it may carry utility statuses, but
    // Pierce would turn its forced-zero effect power into remote true damage and
    // post-damage Wound/Siphon can never resolve. Filter before point/unique
    // accounting so unreachable tags cannot consume a slot or creator budget.
    if (method === 'SINGLE' && candidates.some((tag) => tag.name === 'Move')) {
        candidates = candidates.filter((tag) => tag.name !== 'Pierce' && !REQUIRES_DAMAGE_TAGS.has(tag.name));
    }

    const tags: Array<{ name: string; percent: number }> = [];
    const seen = new Set<string>();
    for (const tag of candidates) {
        if (ap === 40 && FORTY_AP_BLOCKED_TAGS.has(tag.name)) continue;
        if (seen.has(tag.name)) continue;
        if (BLOODLINE_UNIQUE_TAGS.has(tag.name) && usedBloodlineUniqueTags.has(tag.name)) continue;
        seen.add(tag.name);
        if (BLOODLINE_UNIQUE_TAGS.has(tag.name)) usedBloodlineUniqueTags.add(tag.name);
        tags.push({
            name: tag.name,
            percent: BINARY_TAGS.has(tag.name) || FIXED_MAGNITUDE_TAGS.has(tag.name)
                ? 0
                : creatorPercent(tag.percent, rank),
        });
        if (tags.length >= maxTags) break;
    }
    return tags;
}

function normalizeOne(
    raw: Json,
    rank: string | null | undefined,
    sharedType: string,
    sharedElement: string,
    sharedWeatherElement: string | undefined,
    usedBloodlineUniqueTags: Set<string>,
    nukeAlreadyUsed: boolean,
): { jutsu: NormalizedPlayerBloodlineJutsu; usedNuke: boolean } | null {
    const id = safeText(raw.id, 128)?.trim();
    if (!id) return null;

    let method = PLAYER_JUTSU_METHODS.has(String(raw.method)) ? String(raw.method) : 'SINGLE';
    const rawAp = Number(raw.ap);
    let ap: 40 | 60 | 80 = rawAp === 60 || rawAp === 80 ? rawAp : 40;
    if (method === 'AOE_SPIRAL' || method === 'AOE_BURST') ap = 60;

    let tags = normalizeTags(raw.tags, rank, ap, method, usedBloodlineUniqueTags);
    const hasMove = tags.some((tag) => tag.name === 'Move');
    const hasFixedEffect = tags.some((tag) => FIXED_EFFECT_POWER_TAGS.has(tag.name));
    const hasPierce = tags.some((tag) => tag.name === 'Pierce');

    // Pierce is a dedicated 60-AP maker choice. The legacy save sanitizer also
    // enforces this, but sealing it here keeps the canonical stored definition
    // creator-legal instead of relying on a later compatibility pass.
    if (hasPierce && ap === 80) ap = 60;

    // An effect-less ground zone cannot resolve. Preserve the jutsu as an
    // ordinary direct cast instead of sealing a silent no-op.
    if (method === 'INSTANT_EFFECT' && tags.length === 0) method = 'SINGLE';
    if (method === 'AOE_SPIRAL' && tags.every((tag) => tag.name === 'Move')) method = 'AOE_CIRCLE';

    const groundTarget = hasMove || method === 'AOE_CIRCLE' || method === 'INSTANT_EFFECT' || method === 'AOE_SPIRAL';
    const affectsOpponent = ap !== 40 || tags.some((tag) => OPPONENT_AFFECTING_TAGS.has(tag.name));
    const target = groundTarget ? 'EMPTY_GROUND' : method === 'AOE_BURST' || affectsOpponent ? 'OPPONENT' : 'SELF';
    const range = target === 'SELF' ? 0 : Number(raw.range) === 5 ? 5 : 4;

    let usedNuke = false;
    let effectPower = 0;
    if (ap !== 40) {
        if (hasFixedEffect || hasPierce || ap === 80) effectPower = 40;
        else if (Number(raw.effectPower) === 50 && !nukeAlreadyUsed) {
            effectPower = 50;
            usedNuke = true;
        } else effectPower = 40;
    }

    const type = ap === 40 ? 'Any' : sharedType;
    const visualEffect = sanitizeJutsuVisualEffect(raw.visualEffect, ap, target);
    const out: NormalizedPlayerBloodlineJutsu = {
        id,
        name: safeText(raw.name, 120)?.trim() || 'Unnamed Jutsu',
        type,
        element: sharedElement,
        ap,
        range,
        effectPower,
        cooldown: 7,
        currentCooldown: 0,
        chakraCost: 100,
        staminaCost: 100,
        healthCost: 0,
        chakraCostReducePerLvl: 0,
        staminaCostReducePerLvl: 0,
        healthCostReducePerLvl: 0,
        target,
        method,
        tags,
        battleDescription: safeText(raw.battleDescription, 500) ?? '',
        description: safeText(raw.description, 500) ?? safeText(raw.battleDescription, 500) ?? '',
        isUtility: ap === 40,
    };
    const image = safeText(raw.image, 250_000);
    if (image) out.image = image;
    if (sharedWeatherElement) out.weatherElement = sharedWeatherElement;
    if (visualEffect) out.visualEffect = visualEffect;
    return { jutsu: out, usedNuke };
}

/** Normalize one player's complete bloodline jutsu set to creator-legal values. */
export function normalizePlayerBloodlineJutsus(
    rawList: unknown,
    rank: string | null | undefined,
): NormalizedPlayerBloodlineJutsu[] {
    const rawJutsus = (Array.isArray(rawList) ? rawList : [])
        .filter((raw): raw is Json => !!raw && typeof raw === 'object' && !Array.isArray(raw));
    // The maker chooses one offense, special element, and weather affinity for
    // the whole bloodline, then stamps them on every jutsu. Derive that shared
    // profile once so a forged payload cannot cherry-pick a different discipline
    // or weather matchup per button while still using individually valid values.
    const sharedType = (rawJutsus
        .filter((raw) => Number(raw.ap) === 60 || Number(raw.ap) === 80 || raw.method === 'AOE_SPIRAL' || raw.method === 'AOE_BURST')
        .map((raw) => String(raw.type ?? ''))
        .find((type) => PLAYER_JUTSU_TYPES.has(type))
        ?? rawJutsus
            .map((raw) => String(raw.type ?? ''))
            .find((type) => PLAYER_JUTSU_TYPES.has(type)))
        ?? 'Any';
    const sharedElement = rawJutsus
        .map((raw) => safeText(raw.element, 64)?.trim())
        .find((element): element is string => !!element) ?? 'None';
    const sharedWeatherElement = rawJutsus
        .map((raw) => String(raw.weatherElement ?? ''))
        .find((element) => PLAYER_WEATHER_ELEMENTS.has(element));
    const usedIds = new Set<string>();
    const usedBloodlineUniqueTags = new Set<string>();
    let nukeUsed = false;
    const normalized: NormalizedPlayerBloodlineJutsu[] = [];
    for (const raw of rawJutsus) {
        const result = normalizeOne(
            raw,
            rank,
            sharedType,
            sharedElement,
            sharedWeatherElement,
            usedBloodlineUniqueTags,
            nukeUsed,
        );
        if (!result || usedIds.has(String(result.jutsu.id))) continue;
        usedIds.add(String(result.jutsu.id));
        nukeUsed ||= result.usedNuke;
        normalized.push(result.jutsu);
        if (normalized.length >= rankJutsuCount(rank)) break;
    }

    let budgeted = enforceBloodlineBudget(normalized, rank) as NormalizedPlayerBloodlineJutsu[];
    // Structural costs cannot always be paid by stripping optional tags. Invalid
    // over-budget drafts are truncated deterministically; valid maker output is
    // byte-stable and never reaches this branch.
    while (budgeted.length > 0 && bloodlinePoints(budgeted, rank) > (rank === 'S Rank' ? 11 : rank === 'A Rank' ? 10 : 7)) {
        budgeted = budgeted.slice(0, -1);
    }
    return budgeted;
}
