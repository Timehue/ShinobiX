import React from 'react';
import { createRoot } from 'react-dom/client';
import { WildPetBinding } from '../../src/components/WildPetBinding';
import type { Character } from '../../src/types/character';
import type { Pet } from '../../src/types/pet';
import '../../src/styles/tokens.css';
import '../../src/styles/layout/adaptive-stages.css';

const fox = {
    id: 'owned-fox-001', templateId: 'standard-0', name: 'Guild Fox', rarity: 'standard',
    level: 1, hp: 365, attack: 39, defense: 26, speed: 28, jutsus: [],
    origin: 'starter', trait: 'Loyal',
} as Pet;
const wild = {
    id: 'standard-1-17500000', templateId: 'standard-1', name: 'Moonfang',
    rarity: 'standard', level: 1, hp: 395, attack: 43, defense: 28, speed: 32,
    jutsus: [], origin: 'wild', trait: 'Loyal',
} as Pet;
const character = {
    name: 'BindingQA', level: 1, activePetId: fox.id, pets: [fox],
    itemStacks: [{ itemId: 'beast-seal-reinforced', count: 1 }],
} as Character;

const root = createRoot(document.getElementById('root')!);
function mount() {
    root.render(<div style={{ minHeight: '100vh', background: '#0d1620', padding: 20 }}>
        <WildPetBinding
            character={character}
            token="wildbindingqatoken001"
            pet={wild}
            sharedImages={{}}
            onVersionedCharacter={() => true}
            onResolved={() => { document.body.dataset.resolved = 'true'; }}
        />
    </div>);
}
Object.assign(window, { __wildBindingQa: { mount, unmount: () => root.render(null) } });
mount();
