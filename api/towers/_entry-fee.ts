export const BATTLE_FREE_FLOORS = 3;
export const BATTLE_FLOOR_FEE = 1_500;

export type TowerEntryCharacter = {
    ryo?: unknown;
    dailyBattleFloors?: unknown;
    dailyBattleDate?: unknown;
    [key: string]: unknown;
};

const whole = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

export function towerEntryCost(character: TowerEntryCharacter, day: string): number {
    const used = character.dailyBattleDate === day ? whole(character.dailyBattleFloors) : 0;
    return used < BATTLE_FREE_FLOORS ? 0 : BATTLE_FLOOR_FEE;
}

export function debitTowerEntry(character: TowerEntryCharacter, day: string):
    { ok: true; character: TowerEntryCharacter; charged: number } | { ok: false; required: number } {
    const balance = whole(character.ryo);
    const used = character.dailyBattleDate === day ? whole(character.dailyBattleFloors) : 0;
    const charged = used < BATTLE_FREE_FLOORS ? 0 : BATTLE_FLOOR_FEE;
    if (balance < charged) return { ok: false, required: charged };
    return {
        ok: true,
        charged,
        character: { ...character, ryo: balance - charged, dailyBattleFloors: used + 1, dailyBattleDate: day },
    };
}
