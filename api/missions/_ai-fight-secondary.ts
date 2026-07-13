import { masteryHasCapstone } from '../_profession-mastery.js';
import { grantTerritoryScrollsToInventory } from './_mission-catalog.js';
import type { AiFightToken } from './_ai-fight-token.js';

type Character = Record<string, unknown>;

function whole(value: unknown): number {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Apply every ordinary AI-win side effect in the same atomic save mutation as XP/ryo. */
export function applyAiFightSecondaryRewards(
    character: Character,
    token: AiFightToken,
    rewardEligible: boolean,
    ironcladDrop = false,
): Character {
    const battleKind = token.battleKind ?? 'practice';
    if (!rewardEligible || battleKind === 'practice') return character;

    const honorBase = battleKind === 'defense' ? 20 : battleKind === 'raidAi' ? 5 : 0;
    const auraDust = battleKind === 'defense' ? 8 : battleKind === 'raidAi' ? 4 : 0;
    const honorSeals = character.profession === 'vanguard' ? honorBase : 0;
    const boneCharmBonus = honorBase > 0 ? Math.max(1, Math.floor(honorBase / 8)) : 0;
    const fateShardBonus = Math.floor(honorBase / 25);
    const ironcladBonus = ironcladDrop
        && masteryHasCapstone(character.profession, character.masterySpec, 'ironclad') ? 1 : 0;
    const opponentId = token.opponentId;
    const defeatedAiIds = stringList(character.defeatedAiIds);
    const aiKills = character.aiKills && typeof character.aiKills === 'object'
        ? { ...(character.aiKills as Record<string, number>) }
        : {};
    if (opponentId) {
        if (!defeatedAiIds.includes(opponentId)) defeatedAiIds.push(opponentId);
        aiKills[opponentId] = whole(aiKills[opponentId]) + 1;
    }

    return {
        ...character,
        inventory: grantTerritoryScrollsToInventory(character, 1),
        stamina: Math.min(whole(character.maxStamina), whole(character.stamina) + 15),
        honorSeals: whole(character.honorSeals) + honorSeals,
        auraDust: whole(character.auraDust) + auraDust,
        boneCharms: whole(character.boneCharms) + boneCharmBonus + ironcladBonus,
        fateShards: whole(character.fateShards) + fateShardBonus,
        totalAiKills: whole(character.totalAiKills) + 1,
        dailyAiKills: whole(character.dailyAiKills) + 1,
        totalVillageRaids: whole(character.totalVillageRaids) + (battleKind === 'raidAi' ? 1 : 0),
        defeatedAiIds,
        aiKills,
    };
}
