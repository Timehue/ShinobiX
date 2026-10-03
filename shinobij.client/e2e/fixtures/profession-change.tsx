import '../../src/index.css';
import '../../src/styles/veiled-steel.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GrandMarketplace } from '../../src/components/Shop';
import { Inventory } from '../../src/screens/Inventory';
import type { Character } from '../../src/types/character';

const query = new URLSearchParams(location.search);
const initial = {
    name: 'ProfessionQA', village: 'Stormveil Village', level: Number(query.get('level') ?? 20), xp: 321,
    profession: query.get('profession') ?? 'vanguard', professionRank: 8, professionXp: 20000, masterySpec: {},
    storyProgress: 0, fateShards: Number(query.get('shards') ?? 500),
    inventory: query.has('owned') ? ['profession-change-approval'] : [], itemStacks: [], equipment: {}, villageUpgrades: {}, tileCards: [],
} as unknown as Character;

export function ProfessionChangeFixture() {
    const [character, setCharacter] = useState<Character | null>(initial);
    const [screen, setScreen] = useState(query.has('inventory') ? 'inventory' : 'grandMarketplace');
    if (!character) return null;
    return <main style={{ maxWidth: 1040, margin: '0 auto', padding: 12 }}>
        {screen === 'inventory' ? <Inventory character={character} updateCharacter={setCharacter} creatorItems={[]} creatorCards={[]}
            setScreen={setScreen} onVersionedCharacter={next => { setCharacter(next); return true; }} />
            : <GrandMarketplace character={character} creatorItems={[]} onBack={() => undefined}
                onVersionedCharacter={next => { setCharacter(next); return true; }} />}
        <pre hidden data-testid="profession-state">{JSON.stringify(character)}</pre>
    </main>;
}
createRoot(document.getElementById('root')!).render(<ProfessionChangeFixture />);
