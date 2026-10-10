import { useCallback, useState } from 'react';
import type { Character, PlayerRecord, VersionedCharacterCommit, BattleHistoryEntry } from '../types/character';
import type { CreatorAi } from '../types/creator-ai';
import type { Screen } from '../types/core';
import type { TowerHostLoadout } from '../lib/towers-api';
import { WeeklyBossArena } from './WeeklyBossArena';
import { WorldBossEvent } from './WorldBossEvent';
import { WorldBossTabs, type WorldBossTab } from '../components/WorldBossTabs';

export function WorldBossesHub({
    character,
    currentSector,
    initialTab,
    hostLoadout,
    onVersionedCharacter,
    creatorAis,
    setScreen,
    playerRoster,
    sharedImages,
    onRecordBattle,
    onBack,
    bossBackLabel,
}: {
    character: Character;
    currentSector: number;
    initialTab?: WorldBossTab;
    hostLoadout?: TowerHostLoadout;
    onVersionedCharacter: VersionedCharacterCommit;
    creatorAis: CreatorAi[];
    setScreen: (screen: Screen) => void;
    playerRoster: PlayerRecord[];
    sharedImages?: Record<string, string>;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onBack: () => void;
    bossBackLabel?: string;
}) {
    const tabStorageKey = 'worldBosses.activeTab.' + character.name.toLowerCase();
    const [activeTab, setActiveTab] = useState<WorldBossTab>(() => {
        if (initialTab) return initialTab;
        try {
            return sessionStorage.getItem(tabStorageKey) === 'hollow-beast' ? 'hollow-beast' : 'weekly';
        } catch {
            return 'weekly';
        }
    });
    const selectTab = useCallback((tab: WorldBossTab) => {
        setActiveTab(tab);
        try { sessionStorage.setItem(tabStorageKey, tab); } catch { /* keep the tab switch available */ }
    }, [tabStorageKey]);
    const tabBar = <WorldBossTabs active={activeTab} onSelect={selectTab} />;

    if (activeTab === 'weekly') {
        return <WeeklyBossArena
            character={character}
            onVersionedCharacter={onVersionedCharacter}
            creatorAis={creatorAis}
            setScreen={screen => screen === 'centralHub' ? onBack() : setScreen(screen)}
            playerRoster={playerRoster}
            sharedImages={sharedImages}
            worldBossTabs={tabBar}
            screenGuardKey="worldBosses"
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
        backLabel={bossBackLabel ?? 'Central'}
        worldBossTabs={tabBar}
    />;
}
