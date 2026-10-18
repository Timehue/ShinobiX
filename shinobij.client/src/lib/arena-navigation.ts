import type { ArenaDistrictTab, BattleArenaLobbyTab } from '../features/arena/types';
import type { Screen } from '../types/core';
import { isMpvpLeaseMode } from '../../../shared/tower-pvp';

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

export function prepareArenaDistrictReturn(account: string, tab: ArenaDistrictTab): void {
    rememberArenaTab(account, 'district', tab);
    // A retired tournament hint otherwise overrides the explicitly chosen tab.
    if (tab !== 'tournaments') {
        try { sessionStorage.removeItem('tournament-resume'); } catch { /* optional recovery marker */ }
    }
}

/** Recovered matches must reopen the lobby that owns their queue or bracket. */
export function towerBattleRecoveryScreen(account: string, mode: unknown): Screen {
    if (mode === 'tournament' || mode === 'ranked-2v2') {
        prepareArenaDistrictReturn(account, mode === 'tournament' ? 'tournaments' : 'ranked');
        if (mode === 'tournament') {
            try { sessionStorage.setItem('tournament-resume', '1'); } catch { /* optional recovery marker */ }
        }
        return 'arenaDistrict';
    }
    return isMpvpLeaseMode(mode) ? 'battleArena' : 'battleTowers';
}
