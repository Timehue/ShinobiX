/** Isolated native-command fixture; uses the real NPC endpoint and renderer. */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { PetShowdownBattle } from '../components/PetShowdownBattle';
import type { ShowdownStateView, ShowdownTurnResponse } from '../lib/pet-showdown-api';
import '../styles/tokens.css';

const original = window.fetch.bind(window);
const dungeonSeat = new URLSearchParams(location.search).get('dungeon');
const playerName = dungeonSeat === 'desktop' ? 'dungeondesktop' : dungeonSeat === 'mobile' ? 'dungeonmobile' : 'native';
window.fetch = (input, init = {}) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
        const headers = new Headers(init.headers); headers.set('x-tactics-qa-player', playerName);
        return original(input, { ...init, headers });
    }
    return original(input, init);
};
const post = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/pet/showdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, ...body }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `NPC endpoint ${response.status}`);
    return result;
};
const format = new URLSearchParams(location.search).get('format') ?? '2v2';
const size = format === '1v1' ? 1 : format === '3v3' ? 3 : 2;
function NativeHarness() {
    const [initial, setInitial] = useState<ShowdownStateView | null>(null);
    const [error, setError] = useState('');
    const [latest, setLatest] = useState<ShowdownStateView | null>(null);
    useEffect(() => {
        let cancelled = false;
        const timer = window.setTimeout(() => void post(dungeonSeat
            ? { action: 'encounter', petIds: ['native-0'], encounter: { kind: 'dungeon-seal', runToken: `qadungeon${playerName}01` } }
            : { action: 'start', format, sparring: true, petIds: Array.from({ length: size + 2 }, (_, i) => `native-${i}`) })
            .then(result => { if (!cancelled) { setInitial(result.state); setLatest(result.state); } })
            .catch(cause => { if (!cancelled) setError(String(cause)); }), 0);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, []);
    return <><output hidden id="native-state">{JSON.stringify(latest)}</output>{error && <p role="alert">{error}</p>}
        {initial && <PetShowdownBattle initialState={initial} playerPets={[]} sharedImages={{}}
            submitTurn={async commands => { const result = await post({ action: 'turn', sessionId: initial.sessionId, commands }) as ShowdownTurnResponse; if ('state' in result) setLatest(result.state); return result; }}
            onForfeit={() => void post({ action: 'forfeit', sessionId: initial.sessionId })}
            onFinished={() => undefined} onExit={() => location.reload()} onRematch={() => location.reload()} />}</>;
}
createRoot(document.getElementById('root')!).render(<NativeHarness />);
