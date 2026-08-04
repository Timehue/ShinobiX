import type { CombatItem, CombatJutsu } from '../combat-core/types.js';
import { canonicalTagName, GROUND_EFFECT_TAGS, KNOWN_TAG_NAMES } from '../pvp/_tags.js';

export const SOLO_PVE_SUPPORTED_TARGETS = [
    'OPPONENT',
    'SELF',
    'OTHER_USER',
    'CHARACTER',
    'EMPTY_GROUND',
] as const;

export const SOLO_PVE_SUPPORTED_METHODS = [
    'SINGLE',
    'ALL',
    'AOE_CIRCLE',
    'INSTANT_EFFECT',
    'AOE_SPIRAL',
    'AOE_BURST',
    'AOE_LINE', // historical alias for INSTANT_EFFECT
] as const;

const TARGETS = new Set<string>(SOLO_PVE_SUPPORTED_TARGETS);
const METHODS = new Set<string>(SOLO_PVE_SUPPORTED_METHODS);
const ITEM_TARGETS = new Set(['self', 'opponent', 'enemy', 'both']);

export type SoloPveCompatibilityIssue = {
    kind: 'jutsu' | 'item';
    id: string;
    field: string;
    value: string;
    reason: string;
};

export function soloPveJutsuCompatibility(jutsu: CombatJutsu): SoloPveCompatibilityIssue[] {
    const issues: SoloPveCompatibilityIssue[] = [];
    const target = String(jutsu.target ?? 'OPPONENT');
    const method = String(jutsu.method ?? 'SINGLE');
    const effectiveMethod = method === 'AOE_LINE' ? 'INSTANT_EFFECT' : method;
    const names = (jutsu.tags ?? []).map((tag) => canonicalTagName(String(tag.name ?? '')));
    if (!TARGETS.has(target)) issues.push({ kind: 'jutsu', id: jutsu.id, field: 'target', value: target, reason: 'unknown target vocabulary' });
    if (!METHODS.has(method)) issues.push({ kind: 'jutsu', id: jutsu.id, field: 'method', value: method, reason: 'unknown method vocabulary' });
    for (const name of names) {
        if (!KNOWN_TAG_NAMES.has(name)) issues.push({ kind: 'jutsu', id: jutsu.id, field: 'tags', value: name, reason: 'unknown combat tag' });
    }
    if (effectiveMethod === 'INSTANT_EFFECT' && target !== 'EMPTY_GROUND') {
        issues.push({ kind: 'jutsu', id: jutsu.id, field: 'target', value: target, reason: 'INSTANT_EFFECT requires EMPTY_GROUND' });
    }
    if (method === 'AOE_SPIRAL' && (!names.includes('Move') || target !== 'EMPTY_GROUND')) {
        issues.push({ kind: 'jutsu', id: jutsu.id, field: 'method', value: method, reason: 'AOE_SPIRAL requires Move and EMPTY_GROUND' });
    }
    if ((effectiveMethod === 'INSTANT_EFFECT' || method === 'AOE_SPIRAL') && !names.some((name) => GROUND_EFFECT_TAGS.has(name))) {
        issues.push({ kind: 'jutsu', id: jutsu.id, field: 'tags', value: names.join(','), reason: 'persistent ground methods require a supported ground tag' });
    }
    return issues;
}

export function soloPveItemCompatibility(item: CombatItem): SoloPveCompatibilityIssue[] {
    const id = String(item.id ?? item.name ?? 'unknown-item');
    const issues: SoloPveCompatibilityIssue[] = [];
    if (item.weaponEffect && !KNOWN_TAG_NAMES.has(canonicalTagName(item.weaponEffect))) {
        issues.push({ kind: 'item', id, field: 'weaponEffect', value: item.weaponEffect, reason: 'unknown combat tag' });
    }
    for (const tag of item.weaponTags ?? []) {
        const name = canonicalTagName(String(tag.name ?? ''));
        if (!KNOWN_TAG_NAMES.has(name)) issues.push({ kind: 'item', id, field: 'weaponTags', value: name, reason: 'unknown combat tag' });
    }
    if (item.weaponEffectTarget && !ITEM_TARGETS.has(item.weaponEffectTarget)) {
        issues.push({ kind: 'item', id, field: 'weaponEffectTarget', value: item.weaponEffectTarget, reason: 'unknown item target' });
    }
    return issues;
}

export function assertSoloPveLoadoutCompatible(character: Record<string, unknown>): void {
    const jutsu = Array.isArray(character.jutsu) ? character.jutsu as CombatJutsu[] : [];
    const items = Array.isArray(character.pvpItems) ? character.pvpItems as CombatItem[] : [];
    const issues = [
        ...jutsu.flatMap(soloPveJutsuCompatibility),
        ...items.flatMap(soloPveItemCompatibility),
    ];
    if (issues.length > 0) {
        const detail = issues.slice(0, 8).map((issue) => `${issue.kind}:${issue.id}.${issue.field}=${issue.value} (${issue.reason})`).join('; ');
        throw new Error(`Solo-PvE loadout is incompatible: ${detail}`);
    }
}
