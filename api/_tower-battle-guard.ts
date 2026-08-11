import { kv as realKv } from './_storage.js';
import { safeName } from './_utils.js';

export const TOWER_BATTLE_LOCK_KIND = 'battleTowers';
export const TOWER_BATTLE_LOCK_SCREEN = 'battleTowers';
export const TOWER_BATTLE_ACTIVE_ERROR_CODE = 'tower-battle-active';
export const TOWER_BATTLE_ACTIVE_ERROR = 'Finish or recover your active Battle Towers run before starting another battle.';

export type TowerBattleLock = {
    battleId: string;
    kind: typeof TOWER_BATTLE_LOCK_KIND;
    screen: typeof TOWER_BATTLE_LOCK_SCREEN;
    startedAt: number;
    meta: { runId: string; partyId?: string };
};

type BattleLockReader = Pick<typeof realKv, 'get'>;

export function isTowerBattleLock(value: unknown): value is TowerBattleLock {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<TowerBattleLock>;
    return typeof record.battleId === 'string'
        && record.battleId.length >= 1
        && record.battleId.length <= 96
        && record.kind === TOWER_BATTLE_LOCK_KIND
        && record.screen === TOWER_BATTLE_LOCK_SCREEN
        && Number.isFinite(record.startedAt)
        && record.meta?.runId === record.battleId;
}

/**
 * Read-only cross-mode guard. It ignores every legacy/non-Tower lock and throws
 * on storage errors so an uncertain authority read cannot open a second fight.
 */
export async function findTowerBattleStartConflict(
    playerNames: readonly string[],
    store: BattleLockReader = realKv,
): Promise<{ playerName: string; lease: TowerBattleLock } | null> {
    const players = [...new Set(playerNames.map(safeName).filter(Boolean))].sort();
    const rows = await Promise.all(players.map(async playerName => ({
        playerName,
        value: await store.get<unknown>(`battle-lock:${playerName}`),
    })));
    for (const row of rows) {
        if (isTowerBattleLock(row.value)) return { playerName: row.playerName, lease: row.value };
    }
    return null;
}

export function towerBattleActiveErrorBody(): { error: string; errorCode: string } {
    return { error: TOWER_BATTLE_ACTIVE_ERROR, errorCode: TOWER_BATTLE_ACTIVE_ERROR_CODE };
}
