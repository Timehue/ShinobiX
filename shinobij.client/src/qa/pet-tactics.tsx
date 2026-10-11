/** Local harness entry, never included in the production application entry. */
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import { useCallback, useRef, useState } from 'react';
import { PetTacticsArena } from '../components/PetTacticsArena';
import { PetLadderQueuePanel } from '../components/PetLadderQueuePanel';
import type { Character } from '../types/character';

const player = new URLSearchParams(location.search).get('seat') === 'bob' ? 'bob' : 'alice';
const original = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
        const headers = new Headers(init.headers); headers.set('x-tactics-qa-player', player);
        return original(input, { ...init, headers });
    }
    return original(input, init);
};
function RankedHarness() {
    const [character, setCharacter] = useState({ name: player, level: 40, petRankedRating: 1000, pets: [] } as unknown as Character);
    const version = useRef(1);
    const [active, setActive] = useState(false), [fullscreen, setFullscreen] = useState(false);
    const adopt = useCallback((next: Character, incoming: number) => {
        if (next.name !== player || incoming < version.current) return false;
        version.current = incoming; setCharacter(next); return true;
    }, []);
    return <><div hidden data-qa-battle-active={active} data-qa-fullscreen={fullscreen} />
        <PetLadderQueuePanel character={character} onVersionedCharacter={adopt} onBattleActiveChange={setActive} onFullscreenActiveChange={setFullscreen} /></>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('ranked') === '1'
    ? <RankedHarness /> : <PetTacticsArena playerName={player} onExit={() => location.reload()} />);
