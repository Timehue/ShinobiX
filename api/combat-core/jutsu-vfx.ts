import { sanitizeJutsuVisualEffect } from '../_jutsu-visuals.js';
import { canonicalTagName } from '../pvp/_tags.js';
import type { CombatJutsu, CombatTag } from './types.js';

export const MAX_COMBAT_VFX_TILES = 18;

export type CombatVfxSemanticKey =
    | 'fire' | 'fire60' | 'water' | 'water60' | 'wind' | 'wind60'
    | 'lightning' | 'lightning60' | 'earth' | 'earth60' | 'blood'
    | 'shadow' | 'poison' | 'magma' | 'metal' | 'slash' | 'impact'
    | 'pierce' | 'heal' | 'shield' | 'reflect' | 'absorb' | 'spark'
    | 'seal' | 'wound' | 'burn' | 'poisonCloud' | 'drain' | 'cleanse'
    | 'buff' | 'debuff' | 'throwable' | 'weapon' | 'namedWeapon'
    | 'heavy' | 'ko';

export type CombatVfxSemanticAnchor = 'caster' | 'target' | 'tile' | 'area';

type VisualJutsu = CombatJutsu & {
    visualEffect?: string;
    isUtility?: boolean;
};

const SUPPORT_TAGS = new Set([
    'Heal', 'Shield', 'Barrier', 'Reflect', 'Absorb', 'Lifesteal',
    'Increase Damage Given', 'Increase Generals', 'Increase Discipline',
    'Increase Heal', 'Decrease Damage Taken', 'Debuff Prevent',
    'Stun Prevent', 'Overclock',
]);
const DEBUFF_TAGS = new Set([
    'Decrease Damage Given', 'Increase Damage Taken', 'Buff Prevent',
    'Cleanse Prevent', 'Clear Prevent', 'Lag', 'Recoil',
]);
const CONTROL_TAGS = new Set(['Stun', 'Lag']);
const SEAL_TAGS = new Set(['Bloodline Seal', 'Elemental Seal']);

export const CASTER_WARD_VFX_KEYS = new Set<CombatVfxSemanticKey>([
    'heal', 'shield', 'reflect', 'absorb', 'buff', 'cleanse',
]);
export const ELEMENTAL_60_VFX_KEYS = new Set<CombatVfxSemanticKey>([
    'fire60', 'water60', 'wind60', 'lightning60', 'earth60',
]);

export function canonicalJutsuMethod(method?: string): string {
    return method === 'AOE_LINE' ? 'INSTANT_EFFECT' : (method ?? 'SINGLE');
}

export function canonicalJutsuTagNames(tags?: readonly CombatTag[]): string[] {
    return (tags ?? []).map((tag) => canonicalTagName(String(tag.name ?? ''))).filter(Boolean);
}

function hasAny(tags: readonly string[], names: Iterable<string>): boolean {
    for (const name of names) if (tags.includes(name)) return true;
    return false;
}

function elementKey(element?: string | null): CombatVfxSemanticKey | null {
    switch (String(element ?? '').trim().toLowerCase()) {
        case 'fire': case 'flame': case 'ember': case 'ash': case 'smoke': case 'sun': case 'solar': return 'fire';
        case 'water': case 'ice': case 'frost': case 'snow': case 'mist': case 'steam': return 'water';
        case 'wind': case 'air': case 'gale': return 'wind';
        case 'lightning': case 'storm': case 'thunder': case 'shock': case 'plasma': case 'tempest': return 'lightning';
        case 'earth': case 'stone': case 'rock': case 'sand': case 'mud': case 'wood': case 'plant': return 'earth';
        case 'blood': case 'crimson': return 'blood';
        case 'shadow': case 'dark': case 'darkness': case 'void': case 'night': case 'moon': case 'illusion': return 'shadow';
        case 'poison': case 'venom': case 'toxin': case 'acid': return 'poison';
        case 'lava': case 'magma': case 'molten': return 'magma';
        case 'iron': case 'metal': case 'steel': case 'crystal': case 'glass': case 'diamond': case 'magnet': return 'metal';
        default: return null;
    }
}

function elementalSixtyKey(jutsu: VisualJutsu): CombatVfxSemanticKey | null {
    if (Number(jutsu.ap) !== 60 || jutsu.target === 'SELF') return null;
    const selected = sanitizeJutsuVisualEffect(jutsu.visualEffect, jutsu.ap, jutsu.target);
    if (selected) return selected;
    switch (String(jutsu.element ?? '').trim().toLowerCase()) {
        case 'fire': return 'fire60';
        case 'water': return 'water60';
        case 'wind': return 'wind60';
        case 'lightning': return 'lightning60';
        case 'earth': return 'earth60';
        default: return null;
    }
}

function disciplineKey(discipline?: string | null): CombatVfxSemanticKey | null {
    switch (String(discipline ?? '').trim().toLowerCase()) {
        case 'taijutsu': return 'impact';
        case 'bukijutsu': return 'slash';
        case 'genjutsu': return 'debuff';
        default: return null;
    }
}

export function semanticKeyForJutsuTags(tags: readonly string[], ground = false): CombatVfxSemanticKey | null {
    if (tags.includes('Heal')) return 'heal';
    if (hasAny(tags, CONTROL_TAGS)) return 'spark';
    if (hasAny(tags, SEAL_TAGS)) return 'seal';
    if (tags.includes('Copy')) return 'reflect';
    if (tags.includes('Mirror')) return 'debuff';
    if (tags.includes('Push') || tags.includes('Pull')) return 'wind';
    if (tags.includes('Wound')) return 'wound';
    if (tags.includes('Ignition')) return 'burn';
    if (tags.includes('Poison')) return ground ? 'poisonCloud' : 'poison';
    if (tags.includes('Drain') || tags.includes('Siphon')) return 'drain';
    if (tags.includes('Pierce')) return 'pierce';
    if (hasAny(tags, DEBUFF_TAGS)) return 'debuff';
    if (tags.includes('Barrier') || tags.includes('Shield')) return 'shield';
    if (tags.includes('Reflect')) return 'reflect';
    if (tags.includes('Absorb')) return 'absorb';
    if (hasAny(tags, SUPPORT_TAGS)) return 'buff';
    return null;
}

export function isDamagingVisualJutsu(jutsu: VisualJutsu): boolean {
    return Number(jutsu.effectPower ?? 0) > 0 && jutsu.target !== 'SELF' && jutsu.isUtility !== true;
}

export function semanticJutsuVfx(
    jutsu: VisualJutsu,
    options: { ground?: boolean; area?: boolean; heavy?: boolean; ko?: boolean } = {},
): { key: CombatVfxSemanticKey; anchor: CombatVfxSemanticAnchor } {
    const elemental = elementalSixtyKey(jutsu);
    const tags = canonicalJutsuTagNames(jutsu.tags);
    const tagKey = semanticKeyForJutsuTags(tags, Boolean(options.ground));
    const materialKey = elementKey(jutsu.element) ?? disciplineKey(jutsu.type);
    const key = elemental
        ?? (options.ko ? 'ko' : null)
        ?? (tagKey && !(isDamagingVisualJutsu(jutsu) && CASTER_WARD_VFX_KEYS.has(tagKey)) ? tagKey : null)
        ?? materialKey
        ?? tagKey
        ?? (options.heavy ? 'heavy' : 'impact');
    const method = canonicalJutsuMethod(jutsu.method);
    const anchor: CombatVfxSemanticAnchor = options.area || method === 'AOE_CIRCLE' || method === 'AOE_SPIRAL'
        ? 'area'
        : options.ground || jutsu.target === 'EMPTY_GROUND' || method === 'INSTANT_EFFECT'
            ? 'tile'
            : sanitizeJutsuVisualEffect(jutsu.visualEffect, jutsu.ap, jutsu.target)
                ? 'target'
                : jutsu.target === 'SELF' || CASTER_WARD_VFX_KEYS.has(key)
                    ? 'caster'
                    : key === 'buff' && !isDamagingVisualJutsu(jutsu) && hasAny(tags, SUPPORT_TAGS)
                        && !hasAny(tags, DEBUFF_TAGS) && !hasAny(tags, CONTROL_TAGS) && !hasAny(tags, SEAL_TAGS)
                        ? 'caster'
                        : 'target';
    return { key, anchor };
}
