export const VILLAGE_SUPPLY_GOODS: Readonly<Record<string, { name: string; ryo: number; provisions: number }>> = {
    'village-supply-bundle': { name: 'Village Supply Bundle', ryo: 30, provisions: 10 },
    'village-supply-crate': { name: 'Village Supply Crate', ryo: 100, provisions: 40 },
};
export function isVillageSupplyGood(id: string): boolean { return Object.hasOwn(VILLAGE_SUPPLY_GOODS, id); }
export function provisionValue(id: string): number { return id === 'ration-pack' ? 1 : VILLAGE_SUPPLY_GOODS[id]?.provisions ?? 0; }
