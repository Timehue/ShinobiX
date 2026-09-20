import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SunscarFestival } from './screens/SunscarFestival';
import type { Character, VersionedCharacterCommit } from './types/character';
import type { GameItem } from './types/combat';
import { installAuthFetch, setActivePlayer, setActiveToken } from './authFetch';
import { useViewportContract } from './lib/use-viewport-contract';
import './index.css';
import './styles/veiled-steel.css';

// Separate local-only entry. No QA endpoint or seed is in the production build.
const session = await fetch('/__qa/session').then(r => r.json());
setActivePlayer(session.name); setActiveToken(session.token); installAuthFetch();
export function Harness() {
    useViewportContract();
    const [character, setCharacter] = useState<Character | null>(null);
    const [, setCreatorItems] = useState<GameItem[]>([]);
    const version = useRef(0);
    const [, setRenderTick] = useState(0);
    useEffect(() => {
        if (!new URLSearchParams(location.search).has('rerender')) return;
        const timer = window.setInterval(() => setRenderTick(tick => tick + 1), 100);
        return () => window.clearInterval(timer);
    }, []);
    const commit = useCallback<VersionedCharacterCommit>((next, rev) => {
        const incoming = Number(rev);
        if (!Number.isSafeInteger(incoming) || incoming < version.current) return false;
        version.current = incoming; setCharacter(next); return true;
    }, []);
    useEffect(() => { void fetch('/api/festival/caravan?playerName=' + session.name).then(r => r.json()).then(data => commit(data.character, data._saveVersion)); }, [commit]);
    if (!character) return <p>Opening Sunscar…</p>;
    // App supplies a freshly declared callback on each render. Keep this
    // harness equally demanding so an API-read/render loop cannot hide here.
    return <main style={{ minHeight: '100dvh', background: '#1a1917' }}><SunscarFestival character={character} onVersionedCharacter={(next, rev) => commit(next, rev)} setCreatorItems={setCreatorItems} setScreen={() => {}} /></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>);
