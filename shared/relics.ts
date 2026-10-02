/** Canonical 20-item relic roster. All bonuses are PvE-only percentages. */
export const RELIC_OFFENSES = ['Ninjutsu', 'Taijutsu', 'Bukijutsu', 'Genjutsu'] as const;
export const RELIC_ELEMENTS = ['Fire', 'Water', 'Wind', 'Earth', 'Lightning'] as const;
export const PVE_SPECIALIST_FIELDS = [
    'pveNinjutsuDamagePercent', 'pveTaijutsuDamagePercent', 'pveBukijutsuDamagePercent', 'pveGenjutsuDamagePercent',
    'pveFireDamagePercent', 'pveWaterDamagePercent', 'pveWindDamagePercent', 'pveEarthDamagePercent', 'pveLightningDamagePercent',
] as const;
export type PveSpecialistField = typeof PVE_SPECIALIST_FIELDS[number];
export type RelicBonuses = Partial<Record<PveSpecialistField | 'pveDamagePercent', number>>;
export type RelicSource =
    | { kind: 'story'; village: string }
    | { kind: 'chest'; biome: string; chance: number }
    | { kind: 'pvp'; chance: number }
    | { kind: 'tower'; minFloor: number; chance: number }
    | { kind: 'war-crate'; chance: number }
    | { kind: 'weekly-boss'; chance: number };
export type RelicDef = {
    id: string; name: string; slot: 'relic'; rarity: 'rare' | 'epic' | 'legendary';
    cost: number; levelReq: number; image: string; description: string;
    bonuses: RelicBonuses; tier: number; source: RelicSource; extraSources?: readonly RelicSource[];
};
const relic = (id: string, name: string, level: number, tier: number, bonuses: RelicBonuses, source: RelicSource, image?: string): RelicDef => ({
    id, name, slot: 'relic', rarity: tier <= 1 ? 'rare' : tier <= 2 ? 'epic' : 'legendary',
    cost: 0, levelReq: level, tier, bonuses, source,
    image: image ?? `/items/${id}.webp`,
    description: `${name}. Tier ${tier}. ${Object.entries(bonuses).map(([key, value]) => `+${value}% ${key === 'pveDamagePercent' ? 'all' : key.replace('pve', '').replace('DamagePercent', '')} damage against PvE enemies`).join('; ')}. No bonus against players.`,
});

const offenseRelic = (id: string, name: string, offense: typeof RELIC_OFFENSES[number]): RelicDef => ({
    ...relic(id, name, 100, 6, { [`pve${offense}DamagePercent`]: 14 }, { kind: 'tower', minFloor: 15, chance: 0.002 }),
    extraSources: [{ kind: 'pvp', chance: 0.00025 }, { kind: 'war-crate', chance: 0.001 }],
});

export const RELIC_ROSTER: readonly RelicDef[] = [
    relic('event-kesa-storm-seal', "Kesa's Storm-Seal", 58, 1, { pveDamagePercent: 3 }, { kind: 'story', village: 'Stormveil Village' }),
    relic('event-struck-nameplate', "Aren's Struck Name-Plate", 58, 1, { pveDamagePercent: 3 }, { kind: 'story', village: 'Ashen Leaf Village' }),
    relic('event-struck-warmth-token', 'A Struck Warmth-Token', 58, 1, { pveDamagePercent: 3 }, { kind: 'story', village: 'Frostfang Village' }),
    relic('event-sealed-file', 'A Sealed File', 58, 1, { pveDamagePercent: 3 }, { kind: 'story', village: 'Moonshadow Village' }),
    // Chakra Ring remains in the ordinary rare-gear band (10% / 14 items).
    relic('chakra-ring', 'Chakra Ring', 20, 1, { pveDamagePercent: 1 }, { kind: 'chest', biome: 'any', chance: 0.1 / 14 }, '/items/shop-chakra-ring-v1.webp'),
    relic('relic-ashfall-reliquary', 'Ashfall Reliquary', 35, 2, { pveFireDamagePercent: 6 }, { kind: 'chest', biome: 'volcano', chance: 0.003 }),
    relic('relic-rootbound-effigy', 'Rootbound Effigy', 35, 2, { pveEarthDamagePercent: 6 }, { kind: 'chest', biome: 'forest', chance: 0.003 }),
    relic('relic-rimeglass-lens', 'Rimeglass Lens', 45, 2, { pveWaterDamagePercent: 6 }, { kind: 'chest', biome: 'snow', chance: 0.003 }),
    relic('relic-umbral-knot', 'Umbral Knot', 45, 2, { pveGenjutsuDamagePercent: 6 }, { kind: 'chest', biome: 'shadow', chance: 0.003 }),
    relic('relic-stormglass-pendulum', 'Stormglass Pendulum', 60, 3, { pveLightningDamagePercent: 8 }, { kind: 'chest', biome: 'central', chance: 0.0015 }),
    relic('relic-gravewatch-fang', 'Gravewatch Fang', 60, 3, { pveTaijutsuDamagePercent: 8 }, { kind: 'chest', biome: 'central', chance: 0.0015 }),
    relic('relic-drownstone-compass', 'Drownstone Compass', 70, 3, { pveWindDamagePercent: 8 }, { kind: 'chest', biome: 'central', chance: 0.0015 }),
    offenseRelic('relic-duelists-red-cord', "Duelist's Red Cord", 'Bukijutsu'),
    offenseRelic('relic-mirror-mask-shard', 'Mirror-Mask Shard', 'Genjutsu'),
    offenseRelic('relic-conquerors-war-seal', "Conqueror's War Seal", 'Taijutsu'),
    relic('relic-skybreak-prism', 'Skybreak Prism', 70, 4, { pveWindDamagePercent: 12 }, { kind: 'tower', minFloor: 10, chance: 0.01 }),
    offenseRelic('relic-fivefold-chakra-seal', 'Fivefold Chakra Seal', 'Ninjutsu'),
    relic('relic-worldroot-heart', 'Worldroot Heart', 90, 5, { pveEarthDamagePercent: 14 }, { kind: 'tower', minFloor: 14, chance: 0.004 }),
    relic('relic-zenith-lotus', 'Zenith Lotus', 100, 6, { pveDamagePercent: 10 }, { kind: 'tower', minFloor: 15, chance: 0.002 }),
    relic('relic-hollow-gate-cinder', 'Hollow-Gate Cinder', 75, 5, { pveDamagePercent: 8 }, { kind: 'weekly-boss', chance: 0.08 }),
];
export const RELICS_BY_ID = new Map(RELIC_ROSTER.map(item => [item.id, item]));
export const NON_STORY_RELICS = RELIC_ROSTER.filter(item => item.source.kind !== 'story');
export const DUPLICATE_RELIC_SHARDS = 15;
export const RETIRED_RELIC_IDS = ['event-true-roll-page', 'event-unsworn-page', 'event-forged-die'] as const;
export const VILLAGE_RELICS: Readonly<Record<string, string>> = Object.fromEntries(RELIC_ROSTER.flatMap(item =>
    item.source.kind === 'story' ? [[item.source.village, item.id]] : []));

/** Real attack metadata only; weather affinity does not change an attack's element. */
export function pveSpecialistDamagePercent(bonuses: unknown, attack?: { type?: unknown; element?: unknown }): number {
    if (!bonuses || typeof bonuses !== 'object' || !attack) return 0;
    const values = bonuses as Record<string, unknown>;
    const offense = RELIC_OFFENSES.find(value => value.toLowerCase() === String(attack.type ?? '').toLowerCase());
    const element = RELIC_ELEMENTS.find(value => value.toLowerCase() === String(attack.element ?? '').toLowerCase());
    const percent = (key: string) => Math.max(0, Math.min(100, Number(values[key]) || 0));
    return Math.min(100, (offense ? percent(`pve${offense}DamagePercent`) : 0) + (element ? percent(`pve${element}DamagePercent`) : 0));
}

/** Ordinary worn gear is removed from the backpack. Check all ownership stores. */
export function ownsRelic(character: Record<string, unknown>, id: string): boolean {
    return (Array.isArray(character.inventory) && character.inventory.includes(id))
        || (!!character.equipment && typeof character.equipment === 'object' && Object.values(character.equipment).includes(id))
        || (Array.isArray(character.itemStacks) && character.itemStacks.some(raw => raw && typeof raw === 'object'
            && raw.itemId === id && Number(raw.count) > 0));
}

export function grantRelic(character: Record<string, unknown>, id: string): { character: Record<string, unknown>; itemId?: string; fateShards?: number } {
    if (!RELICS_BY_ID.has(id)) throw new Error(`Unknown relic: ${id}`);
    if (ownsRelic(character, id)) return { character: {
        ...character, fateShards: Math.max(0, Number(character.fateShards) || 0) + DUPLICATE_RELIC_SHARDS,
    }, fateShards: DUPLICATE_RELIC_SHARDS };
    return { character: { ...character, inventory: [...(Array.isArray(character.inventory) ? character.inventory : []), id] }, itemId: id };
}

/** One-time owner-approved conversion. Quest objects remain usable for unfinished turn-ins. */
export function migrateRelicRoster(character: Record<string, unknown>): { character: Record<string, unknown>; changed: boolean } {
    if (Number(character.relicRosterVersion) >= 1) return { character, changed: false };
    const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
    const equipment = character.equipment && typeof character.equipment === 'object' ? { ...character.equipment as Record<string, unknown> } : {};
    const targets = new Set<string>();
    for (const id of RETIRED_RELIC_IDS) {
        if (!ownsRelic(character, id)) continue;
        const target = id === 'event-true-roll-page' ? VILLAGE_RELICS['Frostfang Village']
            : id === 'event-unsworn-page' ? VILLAGE_RELICS['Moonshadow Village']
                : VILLAGE_RELICS[String(character.storyVillage ?? character.village)] ?? VILLAGE_RELICS['Stormveil Village'];
        targets.add(target);
        for (const [slot, worn] of Object.entries(equipment)) if (worn === id) {
            delete equipment[slot];
            if (!inventory.includes(id)) inventory.push(id);
        }
    }
    // The Frostfang token was waist gear; move it out of that physical slot.
    for (const [slot, id] of Object.entries(equipment)) if (id === 'event-struck-warmth-token' && slot !== 'relic') {
        delete equipment[slot];
        if (!inventory.includes(id)) inventory.push(id);
    }
    let next: Record<string, unknown> = { ...character, inventory, equipment, relicRosterVersion: 1 };
    for (const id of targets) if (!ownsRelic(next, id)) next = { ...next, inventory: [...next.inventory as unknown[], id] };
    return { character: next, changed: true };
}
