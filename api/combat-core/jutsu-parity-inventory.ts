import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { LEGACY_JUTSU_CATALOG } from '../pvp/_legacy-jutsu-catalog.js';
import { CANONICAL_TAG_NAMES, canonicalTagName } from '../pvp/_tags.js';
import { canonicalJutsuMethod } from './jutsu-vfx.js';
import type { CombatJutsu } from './types.js';

export type JutsuInventorySource = 'built-in' | 'legacy' | 'admin-published';

export type JutsuBehaviorFamily =
    | 'damage'
    | 'healing'
    | 'shielding'
    | 'resource-transfer'
    | 'damage-over-time'
    | 'damage-modifier'
    | 'healing-modifier'
    | 'stat-modifier'
    | 'prevention'
    | 'seal'
    | 'displacement'
    | 'movement'
    | 'copy-mirror'
    | 'cleanse-control'
    | 'ground-zone';

/** Every accepted tag is deliberately assigned to at least one resolver family. */
export const TAG_BEHAVIOR_FAMILIES: Readonly<Record<string, readonly JutsuBehaviorFamily[]>> = {
    Heal: ['healing'],
    Shield: ['shielding'],
    Barrier: ['shielding'],
    Pierce: ['damage'],
    Stun: ['cleanse-control'],
    Poison: ['damage-over-time'],
    Drain: ['resource-transfer'],
    Absorb: ['damage-modifier'],
    Reflect: ['damage-modifier'],
    Lifesteal: ['healing', 'damage-modifier'],
    'Increase Damage Given': ['damage-modifier'],
    'Decrease Damage Given': ['damage-modifier'],
    'Increase Damage Taken': ['damage-modifier'],
    'Decrease Damage Taken': ['damage-modifier'],
    'Increase Heal': ['healing-modifier'],
    'Increase Generals': ['stat-modifier'],
    'Increase Discipline': ['stat-modifier'],
    'Debuff Prevent': ['prevention'],
    'Buff Prevent': ['prevention'],
    'Cleanse Prevent': ['prevention'],
    'Clear Prevent': ['prevention'],
    'Stun Prevent': ['prevention'],
    Copy: ['copy-mirror'],
    Mirror: ['copy-mirror'],
    Push: ['displacement'],
    Pull: ['displacement'],
    'Bloodline Seal': ['seal'],
    'Elemental Seal': ['seal'],
    Wound: ['damage-over-time'],
    Recoil: ['damage-modifier'],
    Move: ['movement'],
    Ignition: ['damage-over-time'],
    Lag: ['stat-modifier'],
    Overclock: ['stat-modifier'],
    Siphon: ['resource-transfer'],
};

export type JutsuParityInventoryRow = {
    id: string;
    name: string;
    source: JutsuInventorySource;
    target: string;
    method: string;
    ap: number;
    cooldown: number;
    range: number;
    chakraCost: number;
    staminaCost: number;
    tags: string[];
    families: JutsuBehaviorFamily[];
    aiProfiles: string[];
};

export type JutsuParityInventory = {
    rows: JutsuParityInventoryRow[];
    sourceCounts: Record<JutsuInventorySource, number>;
    targetCounts: Record<string, number>;
    methodCounts: Record<string, number>;
    tagCounts: Record<string, number>;
    apCosts: number[];
    cooldowns: number[];
    ranges: number[];
    aiReferencedJutsuIds: string[];
    missingAiJutsuIds: string[];
    unmappedCanonicalTags: string[];
};

function increment(target: Record<string, number>, key: string): void {
    target[key] = (target[key] ?? 0) + 1;
}

function addSource(
    target: Map<string, { jutsu: CombatJutsu; source: JutsuInventorySource }>,
    source: JutsuInventorySource,
    values: Iterable<CombatJutsu>,
): void {
    for (const jutsu of values) target.set(jutsu.id, { jutsu, source });
}

/**
 * Builds the review and CI inventory from executable data, never a handwritten
 * list. Callers that can reach the admin store pass its published jutsu here;
 * serverless/unit callers remain deterministic with the shipped catalogs.
 */
export function buildJutsuParityInventory(adminPublished: Iterable<CombatJutsu> = []): JutsuParityInventory {
    const executable = new Map<string, { jutsu: CombatJutsu; source: JutsuInventorySource }>();
    addSource(executable, 'built-in', Object.values(JUTSU_CATALOG));
    addSource(executable, 'legacy', Object.values(LEGACY_JUTSU_CATALOG));
    addSource(executable, 'admin-published', adminPublished);

    const aiByJutsu = new Map<string, Set<string>>();
    for (const profile of Object.values(AI_PROFILE_CATALOG)) {
        const ids = new Set([
            ...profile.jutsuIds,
            ...profile.rules.flatMap((rule) => rule.jutsuId ? [rule.jutsuId] : []),
        ]);
        for (const id of ids) {
            const profiles = aiByJutsu.get(id) ?? new Set<string>();
            profiles.add(profile.id);
            aiByJutsu.set(id, profiles);
        }
    }

    const sourceCounts: Record<JutsuInventorySource, number> = {
        'built-in': 0,
        legacy: 0,
        'admin-published': 0,
    };
    const targetCounts: Record<string, number> = {};
    const methodCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const apCosts = new Set<number>();
    const cooldowns = new Set<number>();
    const ranges = new Set<number>();

    const rows = [...executable.values()].map(({ jutsu, source }) => {
        const target = String(jutsu.target ?? 'OPPONENT');
        const method = canonicalJutsuMethod(jutsu.method);
        const tags = [...new Set((jutsu.tags ?? []).map((tag) => canonicalTagName(tag.name)))].sort();
        const families = new Set<JutsuBehaviorFamily>();
        if (Number(jutsu.effectPower ?? 0) > 0) families.add('damage');
        if (target === 'EMPTY_GROUND' && ['INSTANT_EFFECT', 'AOE_SPIRAL'].includes(method)) families.add('ground-zone');
        for (const tag of tags) {
            increment(tagCounts, tag);
            for (const family of TAG_BEHAVIOR_FAMILIES[tag] ?? []) families.add(family);
        }
        sourceCounts[source] += 1;
        increment(targetCounts, target);
        increment(methodCounts, method);
        apCosts.add(Number(jutsu.ap ?? 40));
        cooldowns.add(Number(jutsu.cooldown ?? 0));
        ranges.add(Number(jutsu.range ?? 0));
        return {
            id: jutsu.id,
            name: jutsu.name,
            source,
            target,
            method,
            ap: Number(jutsu.ap ?? 40),
            cooldown: Number(jutsu.cooldown ?? 0),
            range: Number(jutsu.range ?? 0),
            chakraCost: Number(jutsu.chakraCost ?? 0),
            staminaCost: Number(jutsu.staminaCost ?? 0),
            tags,
            families: [...families].sort(),
            aiProfiles: [...(aiByJutsu.get(jutsu.id) ?? [])].sort(),
        } satisfies JutsuParityInventoryRow;
    }).sort((a, b) => a.id.localeCompare(b.id));

    const aiReferencedJutsuIds = [...aiByJutsu.keys()].sort();
    return {
        rows,
        sourceCounts,
        targetCounts,
        methodCounts,
        tagCounts,
        apCosts: [...apCosts].sort((a, b) => a - b),
        cooldowns: [...cooldowns].sort((a, b) => a - b),
        ranges: [...ranges].sort((a, b) => a - b),
        aiReferencedJutsuIds,
        missingAiJutsuIds: aiReferencedJutsuIds.filter((id) => !executable.has(id)),
        unmappedCanonicalTags: CANONICAL_TAG_NAMES.filter((name) => !(name in TAG_BEHAVIOR_FAMILIES)),
    };
}
