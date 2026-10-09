import { RESOURCE_GRADES, resourceItemId, type ResourceGrade } from './resource-items';
export type OreRequirement = { ids: string[]; count: number; label: string; grade: ResourceGrade };
export const namedForgeOreCount = (kind: 'weapon' | 'armor') => kind === 'weapon' ? 20 : 16;
/** Stronger weapons need purer ore. Higher grades may satisfy a lower requirement,
 * consumed lowest-first; refining cannot bypass the required grade. */
export function resourceForgeRequirement(item: { slot: string; rarity: string; weaponEp?: number; armorQuality?: string }): OreRequirement | null {
    const weapon = item.slot === 'hand' && item.weaponEp != null;
    const armor = ['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot) && item.armorQuality;
    if ((!weapon && !armor) || !['rare', 'epic', 'legendary'].includes(item.rarity)) return null;
    const grade: ResourceGrade = item.rarity === 'legendary' ? 3 : item.rarity === 'epic' ? 2 : 1;
    return { ids: ([0, 1, 2, 3] as ResourceGrade[]).filter(g => g >= grade).map(g => resourceItemId('gather-iron-sand', g)),
        count: weapon ? grade === 3 ? 24 : grade === 2 ? 18 : 10 : item.slot === 'body' ? 14 : item.slot === 'legs' ? 10 : 8,
        grade, label: `${RESOURCE_GRADES[grade]} Iron Sand or better` };
}
