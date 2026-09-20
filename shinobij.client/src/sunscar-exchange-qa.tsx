import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SunscarFestival } from './screens/SunscarFestival';
import type { Character } from './types/character';
import type { GameItem } from './types/combat';
import { installAuthFetch, setActivePlayer, setActiveToken } from './authFetch';
import { createPlayerSaveCoordinator } from './lib/player-save-coordinator';
import { GameToastHost } from './components/GameToast';
import { applyHeartbeatNotices } from './lib/heartbeat-notices';
import { heartbeatNoticeAckFields, noteHeartbeatDelivery } from './lib/notice-ack';
import './index.css';
import './styles/veiled-steel.css';

// Local-only harness: exercise the same authentication and versioned adoption
// used by App. The production build does not include this entry point.
const session = await fetch('/__qa/session').then(r => r.json());
setActivePlayer(session.name); setActiveToken(session.token); installAuthFetch();
const qa = { rejectNextCommit: false, character: null as Character | null, creatorItems: [] as GameItem[], commits: 0, heartbeat: async (): Promise<unknown> => null };
(window as Window & { sunscarQa?: typeof qa }).sunscarQa = qa;

export function Harness() {
    const [character, setCharacter] = useState<Character | null>(null);
    const [creatorItems, setCreatorItems] = useState<GameItem[]>([]);
    // This one-time initializer constructs an independent save coordinator;
    // its refs are read by callbacks, never as React render inputs.
    // eslint-disable-next-line react-hooks/refs
    const [owner] = useState(() => {
        const characterRef = { current: null as Character | null };
        const coordinator = createPlayerSaveCoordinator({
            characterRef, currentAccountNameRef: { current: 'Kaito' }, saveSessionEpochRef: { current: 0 }, pvpCreateScopeAbortRef: { current: new AbortController() },
            setCharacter: update => { const next = typeof update === 'function' ? update(characterRef.current) : update; characterRef.current = next; qa.character = next; qa.commits++; setCharacter(next); },
            setSaveConflictDraft: () => {}, setSaveBlocked: () => {}, applyServerSnapshot: () => true, storage: sessionStorage,
        });
        coordinator.saveAuthority.scopeToAccount('Kaito');
        return coordinator;
    });
    useEffect(() => { qa.creatorItems = creatorItems; }, [creatorItems]);
    useEffect(() => {
        let current = true;
        qa.heartbeat = async () => {
            const response = await fetch('/api/player/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: session.name, sector: 0, ...heartbeatNoticeAckFields() }) });
            const data = await response.json();
            if (!response.ok || !current) throw new Error('QA heartbeat failed.');
            noteHeartbeatDelivery(data);
            await applyHeartbeatNotices(data.pendingNotices, { accountKey: session.name, isCurrent: () => current, commit: owner.commitVersionedCharacter });
            return data.pendingNotices ?? [];
        };
        return () => { current = false; };
    }, [owner]);
    useEffect(() => {
        void fetch('/api/festival/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: 'Kaito', action: 'browse' }) }).then(r => r.json()).then(data => owner.commitVersionedCharacter(data.character, data._saveVersion));
    }, [owner]);
    if (!character) return <p>Opening Sunscar Festival…</p>;
    return <div className="app-shell screen-sunscarFestival" style={{ display: 'block', width: '100%', maxWidth: 1400, margin: '0 auto', padding: 'clamp(8px, 2vw, 24px)' }}><main className="center-game screen-sunscarFestival" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 'none', margin: 0, padding: 0 }}><SunscarFestival character={character} onVersionedCharacter={(next, version) => { if (qa.rejectNextCommit) { qa.rejectNextCommit = false; return false; } return owner.commitVersionedCharacter(next, version); }} setCreatorItems={setCreatorItems} setScreen={() => {}} /></main></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /><GameToastHost /></StrictMode>);
