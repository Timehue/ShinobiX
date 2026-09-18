import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivitySpine } from '../../src/components/ActivitySpine';
import { LiveCapabilitiesContext } from '../../src/lib/live-capabilities-context';
import { LiveCapabilitiesStore } from '../../src/lib/live-capabilities';
import { PUBLIC_CAPABILITY_IDS } from '../../../shared/public-capabilities';
import type { Character } from '../../src/types/character';
import { useActivitySectionRequests } from '../../src/lib/use-activity-section';
import { openActivityDestination } from '../../src/lib/activity-spine-navigation';
import type { ActivitySpineItem } from '../../../shared/activity-spine';

const pending: Array<(value: Response) => void> = [];
let requests = 0;
const clock = Date.now();
let paused = false;
const store = new LiveCapabilitiesStore(async () => ({ ok: true, status: 200, json: async () => ({ ok: true,
    capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, paused && id === 'gameplayMutations' ? { state: 'actions-paused', reason: 'operations-paused' } : { state: 'available', reason: 'available' }])) }), }), () => clock);
// Deliberately ignores abort: tests verify that a late decoded response cannot
// commit, even when transport cancellation cannot stop already-received data.
window.fetch = async () => { requests++; return new Promise(resolve => pending.push(resolve)); };
void store.refresh();

export function Harness() {
    const [character, setCharacter] = useState({ name: 'First', level: 55, pets: [], storyProgress: 4, hp: 100 } as unknown as Character);
    const [destination, setDestination] = useState('');
    const [section, setSection] = useState('overview');
    useActivitySectionRequests('profile.initialTab', ['legacy', 'stats'], setSection);
    return <LiveCapabilitiesContext.Provider value={store}>
        <button onClick={() => setCharacter(c => ({ ...c, name: c.name === 'First' ? 'Second' : 'First' }))}>Switch account</button>
        <button onClick={() => setCharacter(c => ({ ...c, storyProgress: c.storyProgress + 1 }))}>Complete chapter</button>
        <button onClick={() => setCharacter(c => ({ ...c, hp: c.hp + 1 }))}>Regen tick</button>
        <button onClick={() => { const later = Date.now() + 100_000; Date.now = () => later; }}>Expire without render</button>
        <button onClick={() => { paused = true; void store.refresh(); }}>Pause operations</button>
        <output data-testid="destination">{destination}</output>
        <output data-testid="section">{section}</output>
        <button onClick={() => openActivityDestination({ screen: 'profile', section: 'legacy' } as ActivitySpineItem, setDestination)}>Open mounted Legacy</button>
        <button onClick={() => setSection('overview')}>Choose overview</button>
        <ActivitySpine character={character} onNavigate={setDestination} />
    </LiveCapabilitiesContext.Provider>;
}

Object.assign(window, {
    guidanceRequests: () => requests,
    settleGuidance: (index: number, title: string, fail = false, requiredCapabilityIds = ['gameplay', 'gameplayMutations']) => {
        const item = { id: 'fixture', horizon: 'now', title, why: 'Fixture readiness', commitment: '2 min', screen: 'clan', cta: 'Visit Clan Hall', eligibility: 'eligible', requiredCapabilityIds };
        pending[index]?.(new Response(JSON.stringify({ spine: { generatedAt: Date.now(), selectedFocus: 'auto', resolvedFocus: 'clan-war', returningPlayer: false,
            horizons: { now: [item], today: [], 'this-week': [], 'long-term': [] } } }), { status: fail ? 503 : 200, headers: { 'Content-Type': 'application/json' } }));
    },
});
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
