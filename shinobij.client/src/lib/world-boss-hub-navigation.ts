import type { WorldBossTab } from '../components/WorldBossTabs';

export function worldBossTabStorageKey(playerName: string): string {
    return 'worldBosses.activeTab.' + playerName.toLowerCase();
}

/** An explicit map encounter takes priority over the last browsed tab. */
export function worldBossEntryTab(savedTab: unknown, hasWeeklyLaunch: boolean, hasWorldReturn = false): WorldBossTab {
    return !hasWeeklyLaunch && (hasWorldReturn || savedTab === 'hollow-beast') ? 'hollow-beast' : 'weekly';
}

type WorldBossReturn = { playerName: string };
let worldReturn: WorldBossReturn | null = null;
export function stageWorldBossEventReturn(playerName: string): void { worldReturn = { playerName: playerName.toLowerCase() }; }
export function peekWorldBossEventReturn(playerName: string): WorldBossReturn | null {
    return worldReturn?.playerName === playerName.toLowerCase() ? worldReturn : null;
}
export function clearWorldBossEventReturn(entry: WorldBossReturn | null): void { if (entry === worldReturn) worldReturn = null; }
