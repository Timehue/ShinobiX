import type { ArenaDistrictTab, BattleArenaLobbyTab } from '../features/arena/types';

const districtTabs = ['clanWar', 'tournaments', 'ranked', 'spectate', 'petBattles'] as const;
const battleTabs = ['spar', 'teamArena', 'bounty'] as const;
const key = (account: string, lobby: string) => `arenaTab.v1:${account.trim().toLowerCase()}:${lobby}`;

export function readArenaTab(account: string, lobby: 'district'): ArenaDistrictTab;
export function readArenaTab(account: string, lobby: 'battle'): BattleArenaLobbyTab;
export function readArenaTab(account: string, lobby: 'district' | 'battle'): ArenaDistrictTab | BattleArenaLobbyTab {
    const allowed: readonly string[] = lobby === 'district' ? districtTabs : battleTabs;
    try {
        const saved = sessionStorage.getItem(key(account, lobby));
        if (saved && allowed.includes(saved)) return saved as ArenaDistrictTab | BattleArenaLobbyTab;
    } catch { /* optional UI preference */ }
    return lobby === 'district' ? 'ranked' : 'spar';
}

export function rememberArenaTab(account: string, lobby: 'district' | 'battle', tab: ArenaDistrictTab | BattleArenaLobbyTab): void {
    try { sessionStorage.setItem(key(account, lobby), tab); } catch { /* optional UI preference */ }
}
