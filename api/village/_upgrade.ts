export const VILLAGE_UPGRADE_KEYS = ['training', 'jutsuTraining', 'shop', 'townDefense', 'petYard', 'bank', 'missionHall', 'hospital'] as const;
type Key = typeof VILLAGE_UPGRADE_KEYS[number];
const BASE: Record<Key, number> = { training: 10, jutsuTraining: 12, shop: 12, townDefense: 14, petYard: 12, bank: 16, missionHall: 14, hospital: 12 };
export function villageUpgradeCostServer(key: Key, currentLevel: number) { return Math.floor(BASE[key] + currentLevel * 4 + Math.pow(currentLevel, 1.25) * 2); }
export function purchaseVillageUpgrade(character: Record<string, unknown>, keyRaw: unknown) {
    const key = typeof keyRaw === 'string' && VILLAGE_UPGRADE_KEYS.includes(keyRaw as Key) ? keyRaw as Key : null;
    if (!key) return { ok: false as const, reason: 'unknown-village-upgrade' as const };
    const current = character.villageUpgrades && typeof character.villageUpgrades === 'object' ? character.villageUpgrades as Record<string, unknown> : {};
    const level = Math.max(0, Math.min(50, Math.floor(Number(current[key]) || 0)));
    if (level >= 50) return { ok: false as const, reason: 'village-upgrade-max' as const };
    const cost = villageUpgradeCostServer(key, level); const seals = Math.max(0, Math.floor(Number(character.honorSeals) || 0));
    if (seals < cost) return { ok: false as const, reason: 'insufficient-honor-seals' as const };
    return { ok: true as const, cost, level: level + 1, character: { ...character, honorSeals: seals - cost, villageUpgrades: { ...current, [key]: level + 1 } } };
}
