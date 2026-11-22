import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Character, PlayerRecord, VersionedCharacterCommit, BattleHistoryEntry } from '../types/character';
import type { GameItem, SavedBloodline } from '../types/combat';
import type { CreatorAi } from '../types/creator-ai';
import type { Screen } from '../types/core';
import { buildHostLoadout } from '../lib/host-loadout';
import { WeeklyBossArena } from './WeeklyBossArena';
import { WorldBossEvent } from './WorldBossEvent';
import { WorldBossTabs, type WorldBossTab } from '../components/WorldBossTabs';
import { peekWeeklyBossLaunch } from '../lib/weekly-boss-launch';
import { clearWorldBossEventReturn, peekWorldBossEventReturn, worldBossEntryTab, worldBossTabStorageKey } from '../lib/world-boss-hub-navigation';

export function WorldBossesHub({
    character,
    currentSector,
    creatorItems,
    savedBloodlines,
    onVersionedCharacter,
    creatorAis,
    setScreen,
    playerRoster,
    sharedImages,
    onRecordBattle,
    onBack,
}: {
    character: Character;
    currentSector: number;
    creatorItems: GameItem[];
    savedBloodlines: SavedBloodline[];
    onVersionedCharacter: VersionedCharacterCommit;
    creatorAis: CreatorAi[];
    setScreen: (screen: Screen) => void;
    playerRoster: PlayerRecord[];
    sharedImages?: Record<string, string>;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onBack: () => void;
    bossBackLabel?: string;
}) {
    const tabStorageKey = worldBossTabStorageKey(character.name);
    const [worldReturn] = useState(() => peekWorldBossEventReturn(character.name));
    const [activeTab, setActiveTab] = useState<WorldBossTab>(() => {
        try {
            return worldBossEntryTab(sessionStorage.getItem(tabStorageKey), !!peekWeeklyBossLaunch(), !!worldReturn);
        } catch {
            return worldBossEntryTab(null, !!peekWeeklyBossLaunch(), !!worldReturn);
        }
    });
    useEffect(() => { clearWorldBossEventReturn(worldReturn); }, [worldReturn]);
    const selectTab = useCallback((tab: WorldBossTab) => {
        setActiveTab(tab);
        try { sessionStorage.setItem(tabStorageKey, tab); } catch { /* keep the tab switch available */ }
    }, [tabStorageKey]);
    const tabBar = <WorldBossTabs active={activeTab} onSelect={selectTab} />;
    // Hoisted above the early return (hooks must run unconditionally); the
    // loadout only changes with these inputs, not on each idle-regen render.
    // The same builder as Towers, Clan Hall and World Crisis, so the boss queue
    // also posts its items without inline forge art.
    const hostLoadout = useMemo(() => buildHostLoadout(character, savedBloodlines, creatorItems), [character, savedBloodlines, creatorItems]);

    if (activeTab === 'weekly') {
        return <WeeklyBossArena
            character={character}
            onVersionedCharacter={onVersionedCharacter}
            creatorAis={creatorAis}
            setScreen={screen => screen === 'centralHub' ? onBack() : setScreen(screen)}
            playerRoster={playerRoster}
            sharedImages={sharedImages}
            worldBossTabs={tabBar}
            screenGuardKey="weeklyBoss"
        />;
    }

    return <WorldBossEvent
        character={character}
        currentSector={currentSector}
        hostLoadout={hostLoadout}
        sharedImages={sharedImages}
        onVersionedCharacter={onVersionedCharacter}
        onRecordBattle={onRecordBattle}
        onBack={onBack}
        backLabel="Central"
        worldBossTabs={tabBar}
    />;
}
