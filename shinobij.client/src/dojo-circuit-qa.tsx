import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import './index.css';
import './styles/veiled-steel.css';
import { DojoCircuit } from './screens/DojoCircuit';
import { AdminCircuit } from './features/dojo-circuit/AdminCircuit';
import { CircuitCombatResult, CircuitCardResult } from './features/dojo-circuit/CircuitCombatResult';
import { CircuitNotice, CircuitReturnRibbon } from './features/dojo-circuit/CircuitEntry';
import { setSharedDojoCircuitEnabled } from './lib/world-state';
import { onAiFightRequest } from './lib/ai-fight-request';
import type { Character } from './types/character';
import type { Screen } from './types/core';
const params = new URLSearchParams(location.search);
const name = params.get('new') ? 'Newcomer' : 'Kaito';
const character = { name, level: 25, village: params.get('village') ?? 'Stormveil Village', starterCardsClaimed: !params.has('locked'), pets: params.has('locked') ? [] : [{ id: 'qa-pet' }] } as unknown as Character;
setSharedDojoCircuitEnabled(!params.has('off'));
onAiFightRequest(request => { window.dispatchEvent(new CustomEvent('dojo-qa-launch', { detail: request })); return true; });
function Harness() {
    const [screen, setScreen] = useState<Screen>('dojoCircuit');
    if (params.has('cardresult')) return <CircuitCardResult won={params.get('cardresult') === 'win'} draw={params.get('cardresult') === 'draw'} onReturn={() => location.assign('?')} />;
    if (params.has('result')) return <CircuitCombatResult playerName={name} won={params.get('result') === 'win'} draw={params.get('result') === 'draw'} settleState={params.has('failed') ? 'failed' : params.has('pending') ? 'pending' : 'settled'} onRetry={() => location.assign('?result=win')} onExit={() => location.assign('?')} />;
    return <div style={{ maxWidth: 1250, margin: '0 auto', padding: 'clamp(8px, 2vw, 28px)' }}>
        {params.has('admin') ? <AdminCircuit credential="qa-admin" character={character} /> : params.has('notice') ? <CircuitNotice village={character.village} playerName={character.name} onOpen={() => setScreen('dojoCircuit')} /> : screen === 'dojoCircuit' ? <DojoCircuit character={character} setScreen={setScreen} /> : <><CircuitReturnRibbon name={name} screen={screen} onReturn={() => setScreen('dojoCircuit')} /><div data-qa-destination={screen}>{screen}</div></>}
    </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
