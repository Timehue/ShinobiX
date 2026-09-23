import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChroniclePackGallery } from '../../src/components/ChroniclePackGallery';
import { getAllTileCards } from '../../src/data/tile-cards';
import { displayCardsById } from '../../src/lib/chronicle-duel';
import type { Character } from '../../src/types/character';
import '../../src/styles/tokens.css';
import '../../src/styles/chronicle-duel.css';
import '../../src/styles/chronicle-packs.css';
import '../../src/styles/card-pack-opening.css';

const cardsById = displayCardsById(getAllTileCards([]));
Object.assign(window, { __qaFireIds: Object.values(cardsById)
    .filter((card) => card.cardClass === 'monster' && card.element === 'Fire'
        && (card.rarity === 'common' || card.rarity === 'rare'))
    .slice(0, 5).map((card) => card.id) });
const initial = {
    name: 'PackGalleryQA', level: 20, starterCardsClaimed: true,
    chroniclePoints: 200, fateShards: 30, tileCards: [],
} as Character;

function Fixture() {
    const [character, setCharacter] = useState(initial);
    const [version, setVersion] = useState(1);
    return <main style={{ minHeight: '100vh', padding: 24, background: '#0b1019', color: '#eee' }}>
        <div data-testid="adopted-version">{version}</div>
        <ChroniclePackGallery
            character={character}
            cardsById={cardsById}
            onVersionedCharacter={(next, incoming) => {
                if (typeof incoming !== 'number' || incoming <= version) return false;
                setCharacter(next);
                setVersion(incoming);
                return true;
            }}
        />
    </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
