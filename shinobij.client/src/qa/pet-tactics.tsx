/** Local harness entry, never included in the production application entry. */
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/ui.css';
import '../styles/index/01-base-app-chrome.css';
import '../styles/index/05-pet-yard.css';
import '../styles/index/28-modal-close.css';
import '../styles/veiled-steel.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PetTacticsArena } from '../components/PetTacticsArena';
import { PetLadderQueuePanel } from '../components/PetLadderQueuePanel';
import type { Character } from '../types/character';
import { rawPetPool } from '../data/pet-pool';
import { createCharacter } from '../lib/create-character';
import { PetYard } from '../screens/PetYard';

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
    const [character, setCharacter] = useState({ ...createCharacter(player, 'Stormveil Village', 'Ninjutsu', 'Ashen Eyes'), level: 40, petRankedRating: 1000,
        pets: rawPetPool.slice(0, 5).map((p, i) => ({ ...p, id: `ranked-${i}`, templateId: p.id })) } as unknown as Character);
    const version = useRef(1);
    const [active, setActive] = useState(false), [fullscreen, setFullscreen] = useState(false);
    const adopt = useCallback((next: Character, incoming: unknown) => {
        if (typeof incoming !== 'number' || next.name !== player || incoming < version.current) return false;
        version.current = incoming; setCharacter({ ...createCharacter(player, 'Stormveil Village', 'Ninjutsu', 'Ashen Eyes'), ...next }); return true;
    }, []);
    useEffect(() => { void fetch(`/api/save/${player}`).then(res => res.json()).then(data => adopt(data.character, data._saveVersion)); }, [adopt]);
    const [yard, setYard] = useState(new URLSearchParams(location.search).get('yard') === '1');
    return <><div hidden data-qa-battle-active={active} data-qa-fullscreen={fullscreen} />
        <button type="button" onClick={() => setYard(!yard)}>{yard ? 'QA: Ranked screen' : 'QA: Pet Yard'}</button>
        {yard ? <PetYard character={character} updateCharacter={setCharacter as React.Dispatch<React.SetStateAction<Character | null>>}
            onVersionedCharacter={adopt} onServerVersion={() => true} setScreen={() => setYard(false)} onBack={() => setYard(false)} />
            : <PetLadderQueuePanel character={character} onVersionedCharacter={adopt} onBattleActiveChange={setActive} onFullscreenActiveChange={setFullscreen} />}</>;
}
/** Sparring brings the seat's real carried companions, so it needs the save. */
function SparringHarness() {
    const [character, setCharacter] = useState<Character | null>(null);
    useEffect(() => { void fetch(`/api/save/${player}`).then(res => res.json()).then(data => setCharacter({ ...createCharacter(player, 'Stormveil Village', 'Ninjutsu', 'Ashen Eyes'), ...data.character })); }, []);
    return character ? <PetTacticsArena playerName={player} character={character} onExit={() => location.reload()} /> : <p role="status">Loading the QA save…</p>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('ranked') === '1'
    ? <RankedHarness /> : <SparringHarness />);
