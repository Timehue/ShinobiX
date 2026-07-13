"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUNGEON_KEY_ID = exports.WARFORGED_RELIC_ID = exports.LEGENDARY_WAR_CRATE_ID = void 0;
exports.applyWarCrateOpen = applyWarCrateOpen;
exports.LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';
exports.WARFORGED_RELIC_ID = 'warforged-relic';
exports.DUNGEON_KEY_ID = 'dungeon-key';
function applyWarCrateOpen(character, gotDungeonKey) {
    const inventory = Array.isArray(character.inventory)
        ? character.inventory.filter((entry) => typeof entry === 'string')
        : [];
    const crateIndex = inventory.indexOf(exports.LEGENDARY_WAR_CRATE_ID);
    if (crateIndex < 0)
        return null;
    const nextInventory = [...inventory.slice(0, crateIndex), ...inventory.slice(crateIndex + 1), exports.WARFORGED_RELIC_ID];
    if (gotDungeonKey)
        nextInventory.push(exports.DUNGEON_KEY_ID);
    const honorSeals = character.profession === 'vanguard' ? 10 : 0;
    const reward = { ryo: 500, honorSeals, boneCharms: 1, gotDungeonKey };
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
