import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Arena } from '../../src/screens/Arena';
import { AiFightHost } from '../../src/components/AiFightHost';
import { useSealedFightPresence } from '../../src/lib/use-sealed-fight-presence';
import { BATTLE_LEAVE_NOTICE, useBattleNavigationGuard } from '../../src/lib/use-battle-navigation-guard';
import { useAiFightCloseNavigation } from '../../src/lib/use-ai-fight-close-navigation';
import type { Character } from '../../src/types/character';
import type { Screen } from '../../src/types/core';
import '../../src/index.css';
import '../../src/styles/late-normalize.css';
import '../../src/styles/veiled-steel.css';
import '../../src/styles/layout/adaptive-shell.css';
import '../../src/styles/layout/adaptive-stages.css';
import '../../src/styles/input-accessibility.css';

const initial = { name: 'ArenaDiver', level: 100, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500,
    stamina: 500, maxStamina: 500, ryo: 456, xp: 0, rankTitle: 'Kage', specialty: 'Ninjutsu',
    village: 'Stormveil Village', stats: {}, jutsu: [], inventory: [], itemStacks: [], equipment: {}, pets: [],
    battleHistory: [{ id: 'already-learned' }], completedStoryBattles: ['academy-sparring'] } as unknown as Character;

// Use the real Arena launcher, sealed host, combat screen, close handoff and
// navigation guard. Only the API is supplied by Playwright; no local reducer.
function Fixture() {
    const [character, setCharacter] = useState(initial);
    const [screen, setScreen] = useState<Screen>(() => sessionStorage.getItem('arena-qa-screen') as Screen || 'arena');
    const screenRef = useRef(screen);
    useLayoutEffect(() => { screenRef.current = screen; sessionStorage.setItem('arena-qa-screen', screen); }, [screen]);
    const presence = useSealedFightPresence();
    const [missionBattleActive, setMissionBattleActive] = useState(false);
    const [notice, setNotice] = useState('');
    const { inBattleRef } = useBattleNavigationGuard({ screen, screenRef, setScreen, hospitalized: false, account: character.name,
        raidBattleKind: 'none', pvpBattleId: null, endlessBattleActive: false, pendingArenaStoryBattle: false,
        pendingEventEncounter: false, activeDungeonEvent: false, hollowGateTileGameActive: false, pendingPetBattle: false,
        arenaBattleActive: false, petBattleActive: false, missionBattleActive });
    const navigate = (next: Screen) => {
        if (inBattleRef.current || presence.engagedRef.current) { setNotice(BATTLE_LEAVE_NOTICE); return; }
        setNotice(''); setScreen(next);
    };
    const { onClose } = useAiFightCloseNavigation({ account: character.name, sealedFightOpen: presence.sealedFightOpen,
        missionBattleActive, setMissionBattleActive, navigate });
    return <main style={{ color: 'white', padding: 12 }}>
        <p data-testid="arena-screen">{screen}</p><p data-testid="arena-hp">{character.hp}</p>
        <button data-testid="arena-village" onClick={() => navigate('village')}>Village</button>
        <p data-testid="arena-notice">{notice}</p>
        {screen === 'village' ? <h1>Village reached</h1> : <Arena character={character} updateCharacter={setCharacter}
            onVersionedCharacter={next => { setCharacter(next); return true; }} savedBloodlines={[]} creatorJutsus={[]}
            playerRoster={[]} duelChallenges={[]} setDuelChallenges={() => {}} setScreen={navigate}
            onAcceptChallenge={() => {}} onDeclineChallenge={() => {}} />}
        <AiFightHost character={character} sharedImages={{}} onFightOpenChange={presence.setAiFightOpen} onClose={onClose}
            onSettled={result => { if (result.character) setCharacter(result.character); }} />
    </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
