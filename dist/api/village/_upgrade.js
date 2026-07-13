"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VILLAGE_UPGRADE_KEYS = void 0;
exports.villageUpgradeCostServer = villageUpgradeCostServer;
exports.purchaseVillageUpgrade = purchaseVillageUpgrade;
exports.VILLAGE_UPGRADE_KEYS = ['training', 'jutsuTraining', 'shop', 'townDefense', 'petYard', 'bank', 'missionHall', 'hospital'];
const BASE = { training: 10, jutsuTraining: 12, shop: 12, townDefense: 14, petYard: 12, bank: 16, missionHall: 14, hospital: 12 };
function villageUpgradeCostServer(key, currentLevel) { return Math.floor(BASE[key] + currentLevel * 4 + Math.pow(currentLevel, 1.25) * 2); }
function purchaseVillageUpgrade(character, keyRaw) {
    const key = typeof keyRaw === 'string' && exports.VILLAGE_UPGRADE_KEYS.includes(keyRaw) ? keyRaw : null;
    if (!key)
        return { ok: false, reason: 'unknown-village-upgrade' };
    const current = character.villageUpgrades && typeof character.villageUpgrades === 'object' ? character.villageUpgrades : {};
    const level = Math.max(0, Math.min(50, Math.floor(Number(current[key]) || 0)));
    if (level >= 50)
        return { ok: false, reason: 'village-upgrade-max' };
    const cost = villageUpgradeCostServer(key, level);
    const seals = Math.max(0, Math.floor(Number(character.honorSeals) || 0));
    if (seals < cost)
        return { ok: false, reason: 'insufficient-honor-seals' };
    return { ok: true, cost, level: level + 1, character: { ...character, honorSeals: seals - cost, villageUpgrades: { ...current, [key]: level + 1 } } };
}
