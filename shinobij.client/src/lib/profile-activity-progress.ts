import { readResourceGathering, resourceSkillLevel, RESOURCE_SKILL_XP } from '../../../shared/resource-gathering';
import { HUNTER_RANK_LABELS, HUNTER_RANKUP, HUNT_MATERIAL_NAMES } from '../constants/hunter';
import { countItem } from './inventory';
import type { Character } from '../types/character';

export function profileActivityProgress(character: Character) {
    const gathering = readResourceGathering(character.resourceGathering);
    const rows = (['Mining', 'Fishing'] as const).map(label => {
        const xp = label === 'Mining' ? gathering.miningXp : gathering.fishingXp;
        const level = resourceSkillLevel(xp), floor = RESOURCE_SKILL_XP[level - 1], next = RESOURCE_SKILL_XP[level];
        return { label, value: `Lv. ${level}`, detail: next === undefined ? 'MAX · level cap reached' : `${(xp - floor).toLocaleString()}/${(next - floor).toLocaleString()} XP to next level` };
    });
    const rawRank = Number(character.hunterRank ?? 0);
    const rank = Number.isFinite(rawRank) ? Math.max(0, Math.min(HUNTER_RANK_LABELS.length - 1, Math.floor(rawRank))) : 0;
    const requirement = HUNTER_RANKUP[rank];
    return [...rows, { label: 'Hunting', value: HUNTER_RANK_LABELS[rank], detail: requirement
        ? `${countItem(character, requirement.itemId).toLocaleString()}/${requirement.qty.toLocaleString()} ${HUNT_MATERIAL_NAMES[requirement.itemId]} toward next rank`
        : 'MAX · highest Hunter Rank' }];
}
