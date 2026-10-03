import '../../src/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GrandMarketplace } from '../../src/components/Shop';
import type { Character } from '../../src/types/character';
import { Inventory } from '../../src/screens/Inventory';
import '../../src/styles/veiled-steel.css';

const query = new URLSearchParams(location.search);
const initial = {
    name: 'TransferQA', village: 'Stormveil Village', level: Number(query.get('level') ?? 100),
    storyProgress: Number(query.get('story') ?? 9), fateShards: Number(query.get('shards') ?? 500),
    inventory: query.has('owned') ? ['village-transfer-scroll'] : [], itemStacks: [], equipment: {}, villageUpgrades: {}, tileCards: [],
} as unknown as Character;
function Fixture() {
    const [character, setCharacter] = useState<Character | null>(initial);
    const [screen, setScreen] = useState(query.has('inventory') ? 'inventory' : 'grandMarketplace');
    if (!character) return null;
    return <main style={{ maxWidth: 1040, margin: '0 auto', padding: 12 }}>
        {screen === 'inventory' ? <Inventory character={character} updateCharacter={setCharacter} creatorItems={[]} creatorCards={[]}
            setScreen={setScreen} onVersionedCharacter={next => { setCharacter(next); return true; }} />
            : <GrandMarketplace character={character} creatorItems={[]} onBack={() => undefined}
                onVersionedCharacter={next => { setCharacter(next); return true; }} />}
        <pre hidden data-testid="transfer-state">{JSON.stringify(character)}</pre>
    </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
