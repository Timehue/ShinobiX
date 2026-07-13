export const LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';
export const WARFORGED_RELIC_ID = 'warforged-relic';
export const DUNGEON_KEY_ID = 'dungeon-key';

export type WarCrateOpenReward = {
    ryo: 500;
    honorSeals: number;
    boneCharms: 1;
    gotDungeonKey: boolean;
};

export function applyWarCrateOpen(
    character: Record<string, unknown>,
    gotDungeonKey: boolean,
): { character: Record<string, unknown>; reward: WarCrateOpenReward } | null {
    const inventory = Array.isArray(character.inventory)
        ? (character.inventory as unknown[]).filter((entry): entry is string => typeof entry === 'string')
        : [];
    const crateIndex = inventory.indexOf(LEGENDARY_WAR_CRATE_ID);
    if (crateIndex < 0) return null;

    const nextInventory = [...inventory.slice(0, crateIndex), ...inventory.slice(crateIndex + 1), WARFORGED_RELIC_ID];
    if (gotDungeonKey) nextInventory.push(DUNGEON_KEY_ID);
    const honorSeals = character.profession === 'vanguard' ? 10 : 0;
    const reward: WarCrateOpenReward = { ryo: 500, honorSeals, boneCharms: 1, gotDungeonKey };
    return {
        character: {
            ...character,
            inventory: nextInventory,
            ryo: Math.max(0, Number(character.ryo) || 0) + reward.ryo,
            honorSeals: Math.max(0, Number(character.honorSeals) || 0) + reward.honorSeals,
            boneCharms: Math.max(0, Number(character.boneCharms) || 0) + reward.boneCharms,
        },
        reward,
    };
}
