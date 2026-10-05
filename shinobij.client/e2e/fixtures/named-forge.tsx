import '../../src/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CentralHub } from '../../src/screens/CentralHub';
import type { Character } from '../../src/types/character';
import type { GameItem } from '../../src/types/combat';

sessionStorage.setItem('centralHub.initialPanel', 'crafter');
const initial = {
    name: 'ForgeQA', level: 100, village: 'Mist', element: 'Water', elements: ['Water'],
    hp: 1000, maxHp: 1000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
    ryo: 10000, fateShards: Number(new URLSearchParams(location.search).get('shards') ?? 200),
    boneCharms: 5000, auraStones: 5000, mythicSeals: 5000,
    inventory: [], itemStacks: [], equipment: {}, stats: {}, jutsuMastery: [], claimedAwakenings: [],
    equippedJutsuIds: [], learnedJutsuIds: [], completedMissions: [], onboardingStep: 'done',
} as Character;

export function Fixture() {
    const [character, setCharacter] = useState(initial);
    const [creatorItems, setCreatorItems] = useState<GameItem[]>([]);
    const [triggeredEvents, setTriggeredEvents] = useState<string[]>([]);
    const [saveVersion, setSaveVersion] = useState(1);
    return <><CentralHub character={character} updateCharacter={setCharacter} setScreen={() => undefined}
        savedBloodlines={[]} triggeredEvents={triggeredEvents} setTriggeredEvents={setTriggeredEvents}
        onStartDungeon={() => undefined} onOpenBloodlineMaker={() => undefined}
        creatorItems={creatorItems} setCreatorItems={setCreatorItems} playableAis={[]}
        onVersionedCharacter={(next, version) => {
            if (typeof version !== 'number' || version <= saveVersion) return false;
            setCharacter(next);
            setSaveVersion(version);
            return true;
        }}
    /><pre hidden data-testid="forge-state">{JSON.stringify({ character, creatorItems, saveVersion })}</pre></>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
