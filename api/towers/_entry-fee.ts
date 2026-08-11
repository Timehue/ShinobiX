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

export type TowerStoryEntryDebit =
    | { ok: true; character: TowerEntryCharacter; charged: number; counted: boolean; replayFree: boolean }
    | { ok: false; required: number };

export function hasClearedTowerFloor(character: TowerEntryCharacter, floorId: number): boolean {
    const floor = Math.floor(Number(floorId));
    return floor > 0 && Array.isArray(character.battleTowerClearedFloors)
        && (character.battleTowerClearedFloors as unknown[]).some(value => Math.floor(Number(value)) === floor);
}

/** Story replays are free and consume no daily entry slot; uncleared floors keep the normal toll. */
export function debitTowerStoryEntry(
    character: TowerEntryCharacter,
    day: string,
    floorId: number,
): TowerStoryEntryDebit {
    if (hasClearedTowerFloor(character, floorId)) {
        return { ok: true, character, charged: 0, counted: false, replayFree: true };
    }
    const result = debitTowerEntry(character, day);
    return result.ok
        ? { ...result, counted: true, replayFree: false }
        : result;
}

/**
 * Compensate a successfully reserved entry when the corresponding session was
 * conclusively not published. Ryo is always restored; the daily counter is
 * rolled back only while it still belongs to the same UTC day, so a concurrent
 * day rollover is never overwritten with stale state.
 */
export function refundTowerEntry(
    character: TowerEntryCharacter,
    day: string,
    charged: number,
    counted = true,
): TowerEntryCharacter {
    const refund = Math.max(0, Math.floor(Number(charged) || 0));
    const next: TowerEntryCharacter = { ...character, ryo: whole(character.ryo) + refund };
    if (counted && character.dailyBattleDate === day) {
        next.dailyBattleFloors = Math.max(0, whole(character.dailyBattleFloors) - 1);
    }
    return next;
}
