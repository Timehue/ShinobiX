import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleTowerFight } from '../../src/screens/BattleTowerFight';
import { ClanHall } from '../../src/screens/ClanHall';
import { LiveCapabilitiesContext } from '../../src/lib/live-capabilities-context';
import { LiveCapabilitiesStore } from '../../src/lib/live-capabilities';
import { PUBLIC_CAPABILITY_IDS } from '../../../shared/public-capabilities';
import type { Character } from '../../src/types/character';
import type { TowerSession } from '../../src/lib/towers-api';
import { viewportClassForWidth } from '../../src/lib/viewport-contract';
import '../../src/index.css';
import '../../src/styles/late-normalize.css';
import '../../src/styles/veiled-steel.css';
import '../../src/styles/layout/adaptive-shell.css';
import '../../src/styles/layout/adaptive-stages.css';
import '../../src/styles/input-accessibility.css';

// Playwright supplies a real, deterministic encounter built in Node. Only the
// terminal transport receipt is stubbed; the production fight/result UI runs.
const params = new URLSearchParams(location.search);
const seed = (window as unknown as { clanResultSeed: { session: TowerSession; character: Character } }).clanResultSeed;
const session: TowerSession = JSON.parse(JSON.stringify(seed.session));
const ordinary = params.has('ordinary');
const qa = { settlements: 0, exits: 0, commits: 0, bankings: 0 };
Object.assign(window, { clanResultQa: qa });
document.documentElement.dataset.vp = viewportClassForWidth(window.innerWidth);

export function ClanBossResultFixture() {
    const [returned, setReturned] = useState(false);
    if (returned) return <main style={{ color: 'white', padding: 24 }}>
        <h1 data-testid="returned-screen">{ordinary ? 'Battle Towers' : 'Clan Hall'}</h1>
    </main>;
    return <BattleTowerFight character={seed.character} runId={session.runId} initialSession={session}
        variant={ordinary ? 'tower' : 'clan-boss'}
        stateFn={async () => session}
        settleOnAnyDone
        settleFn={ordinary ? undefined : async () => {
            qa.settlements++;
            if (params.has('reject') && qa.settlements === 1) return { error: 'Contribution receipt pending.' };
            if (qa.bankings === 0) qa.bankings++;
            return { ok: true, alreadySettled: qa.settlements > 1, character: seed.character, _saveVersion: 7,
                result: { won: session.winner === 'squad', damage: 16_747 }, pool: 5_253 };
        }}
        onVersionedCharacter={() => { qa.commits++; return true; }}
        onExit={() => { qa.exits++; setReturned(true); }} />;
}

// Exercise the real Clan Hall -> ClanBoss -> BattleTowerFight -> ClanBoss
// return chain. Playwright routes only HTTP transport; no local result reducer
// or replacement return screen can make the production recovery path pass.
function FullFlowFixture() {
    const [character, updateCharacter] = useState<Character | null>(seed.character);
    if (!character) return null;
    return <ClanHall character={character} updateCharacter={updateCharacter}
        onVersionedCharacter={next => { qa.commits++; updateCharacter(next); return true; }}
        creatorItems={[]} savedBloodlines={[]} setScreen={() => {}} />;
}

if (params.has('fullFlow')) {
    sessionStorage.setItem('clan.initialView', 'boss');
    const capabilities = Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }]));
    const store = new LiveCapabilitiesStore(async () => ({ ok: true, status: 200,
        json: async () => ({ ok: true, capabilities }) }));
    void store.refresh().then(() => createRoot(document.getElementById('root')!).render(
        <LiveCapabilitiesContext value={store}><FullFlowFixture /></LiveCapabilitiesContext>));
} else {
    createRoot(document.getElementById('root')!).render(<ClanBossResultFixture />);
}
