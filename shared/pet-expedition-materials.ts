import { RESOURCE_ITEMS, resourceItemId, type ResourceFamily, type ResourceGrade } from './resource-items.js';
import type { PetExpeditionType } from './pet-expedition-contract.js';

export type PetExpeditionMaterialReward = { itemId: string; count: number };
export const PET_EXPEDITION_MATERIAL_BASE_COUNTS = { scout: 3, forage: 6, ruins: 12 } as const;

/** Common / Fine (rare hunting) / Superior (epic hunting) / Pristine (legendary hunting). */
export const PET_EXPEDITION_MATERIAL_GRADE_WEIGHTS = {
    scout: [85, 14, 1, 0], forage: [60, 30, 9, 1], ruins: [35, 40, 22, 3],
} as const;
export const PET_EXPEDITION_MATERIAL_LABELS: Readonly<Record<PetExpeditionType, string>> = Object.fromEntries(
    Object.entries(PET_EXPEDITION_MATERIAL_GRADE_WEIGHTS).map(([type, weights]) => [type,
        `Mixed hunting, fishing, mining, and harvesting supplies · ${100 - weights[0]}% better-quality rolls`,
    ]),
) as Record<PetExpeditionType, string>;

const HUNT_FINDS = [
    ['hunt-beast-meat', 'hunt-torn-hide', 'hunt-wild-feather', 'hunt-small-fang', 'hunt-cracked-horn'],
    ['hunt-wolf-fang', 'hunt-frost-pelt', 'hunt-ash-scale', 'hunt-shadow-claw'],
    ['hunt-shadow-pelt', 'hunt-ember-scale', 'hunt-ancient-beast-core', 'hunt-titan-bone'],
    ['hunt-legendary-material'],
] as const;
const HARVEST_FINDS = ['gather-field-herb', 'gather-binding-fiber', 'gather-heartwood-bark', 'gather-shadow-thread'] as const;
const MINERAL_FAMILIES: readonly ResourceFamily[] = ['gather-iron-sand', 'gather-rime-crystal', 'gather-ember-ore', 'gather-stormglass-shard'];
const MATERIAL_IDS = new Set<string>([...HUNT_FINDS.flat(), ...HARVEST_FINDS, ...RESOURCE_ITEMS.map(item => item.id)]);

/** Read only bounded canonical supplies from a saved server seal or receipt. */
export function readPetExpeditionMaterials(value: unknown): PetExpeditionMaterialReward[] {
    if (!Array.isArray(value)) return [];
    return value.filter((reward): reward is PetExpeditionMaterialReward => reward && typeof reward === 'object'
        && MATERIAL_IDS.has(reward.itemId) && Number.isSafeInteger(reward.count) && reward.count > 0 && reward.count <= 64).slice(0, 48);
}

/** Each unit draws one of four activities, then its route's quality.
 * Harvesting has existing common/regional supplies rather than graded items.
 * The biome argument is retained for callers. No gathering skill XP is awarded. */
export function rollPetExpeditionMaterials(
    type: PetExpeditionType,
    _biome: string,
    multiplier: number,
    random: () => number,
): PetExpeditionMaterialReward[] {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return [];
    const unit = () => Math.max(0, Math.min(0.999999999, random()));
    const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(unit() * pool.length)];
    const scaled = PET_EXPEDITION_MATERIAL_BASE_COUNTS[type] * Math.min(4, multiplier);
    const count = Math.floor(scaled) + (unit() < scaled % 1 ? 1 : 0);
    const rewards = new Map<string, number>();
    for (let index = 0; index < count; index++) {
        const activity = Math.floor(unit() * 4);
        const qualityRoll = unit() * 100;
        const weights = PET_EXPEDITION_MATERIAL_GRADE_WEIGHTS[type];
        let gradeIndex = 0;
        let cumulative = weights[0] as number;
        while (gradeIndex < 3 && qualityRoll >= cumulative) cumulative += weights[++gradeIndex];
        const grade = gradeIndex as ResourceGrade;
        const itemId = activity === 0 ? pick<string>(HUNT_FINDS[grade])
            : activity === 1 ? resourceItemId('gather-river-fish', grade)
                : activity === 2 ? resourceItemId(pick(MINERAL_FAMILIES), grade)
                    : pick(grade === 0 ? HARVEST_FINDS.slice(0, 2) : HARVEST_FINDS.slice(2));
        rewards.set(itemId, (rewards.get(itemId) ?? 0) + 1);
    }
    return [...rewards].map(([itemId, count]) => ({ itemId, count }));
}

/** Apportion the scaled total across sealed stacks. Independent flooring would
 * erase single-item mixed hauls after a setback and discard discovery bonuses. */
export function petExpeditionReturnMaterials(rewards: readonly PetExpeditionMaterialReward[], multiplier: number): PetExpeditionMaterialReward[] {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return [];
    const valid = readPetExpeditionMaterials(rewards);
    const scaled = valid.map(({ itemId, count }) => ({ itemId, count: Math.floor(count * multiplier) }));
    const target = Math.floor(valid.reduce((total, reward) => total + reward.count, 0) * multiplier);
    const remaining = target - scaled.reduce((total, reward) => total + reward.count, 0);
    const order = valid.map(({ count }, index) => ({ index, fraction: count * multiplier % 1 }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < remaining; index++) scaled[order[index].index].count++;
    return scaled.filter(({ count }) => count > 0);
}
