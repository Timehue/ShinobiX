import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import '../../src/index.css';
import '../../src/styles/late-normalize.css';
import '../../src/styles/veiled-steel.css';
import '../../src/styles/layout/adaptive-shell.css';
import '../../src/styles/layout/adaptive-stages.css';
import '../../src/styles/mobile-noncombat-aaa.css';
import { StrongholdExplore } from '../../src/features/anbuInfiltration/StrongholdExplore';
import { AnbuVaultRaid } from '../../src/features/anbuInfiltration/AnbuVaultRaid';
import { LiveCapabilitiesContext } from '../../src/lib/live-capabilities-context';
import { LiveCapabilitiesStore } from '../../src/lib/live-capabilities';
import type { Character, PlayerRecord } from '../../src/types/character';
import { PUBLIC_CAPABILITY_IDS } from '../../../shared/public-capabilities';
import { useViewportContract } from '../../src/lib/use-viewport-contract';
import { WorldSectorCanvas } from '../../src/components/WorldSectorCanvas';
const params = new URLSearchParams(location.search);
const capabilities = Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }]));
const store = new LiveCapabilitiesStore(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, capabilities }) }));
void store.refresh();
export function Fixture() {
    useViewportContract();
    const [character, setCharacter] = useState<Character>({ name: 'scout', level: 100, village: 'Frostfang Village', avatarImage: params.has('cachedAvatar') ? '' : '/anbu/frostfang.webp',
        hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, jutsu: [], inventory: [], itemStacks: [], jutsuMastery: [] } as Character);
    const [exited, setExited] = useState(params.has('lifecycle'));
    const props = { character, sector: Number(params.get('sector') ?? 12), targetVillage: 'Moonshadow Village',
        sharedImages: params.has('cachedAvatar') ? { 'avatar:scout': '/anbu/frostfang.webp', 'avatar:rival': '/anbu/moonshadow.webp' } : {}, onExit: () => setExited(true),
        onAttackPlayer: async (peer: PlayerRecord) => {
            document.body.dataset.attack = peer.name;
            document.body.dataset.attackCount = String(Number(document.body.dataset.attackCount ?? 0) + 1);
            if (params.has('holdAttack')) await new Promise<void>(resolve => Object.assign(window, { releaseStrongholdAttack: resolve }));
            else if (params.has('controlledAttack')) {
                const response = await fetch('/api/qa/stronghold-attack', { method: 'POST', body: JSON.stringify({ playerName: character.name, target: peer.name }) });
                if (!response.ok) throw new Error('Attack could not be confirmed. Reconnect and try again.');
            } else await new Promise(resolve => setTimeout(resolve, 700));
        } };
    const present = (content: React.ReactNode) => params.has('backdrop') ? <WorldSectorCanvas sector={99} biome="volcano" ambienceBiome="volcano" weather="clear"
        playerTile={50} playerName="scout" playerAvatarImage="/anbu/frostfang.webp" isCurrent suspended={!exited}
        enterDirection={null} regionSplash={null} onRegionSplashDone={() => {}} sceneImage="/anbu/moonshadow.webp"
        mapImage={params.get('backdrop') === '3d' ? undefined : '/anbu/moonshadow.webp'} roadExits={[]} showLivePeers={false}
        players={[]} sharedImages={{}} sleeperPeers={[]} onSelectTile={() => {}} onCrossExit={() => {}} overlayLayer={content} encounterLayer={null} /> : content;
    if (exited) return present(<><h1>Returned to sector</h1>{params.has('lifecycle') && <button onClick={() => setExited(false)}>Enter preview</button>}</>);
    return present(<LiveCapabilitiesContext.Provider value={store}>
        {params.has('lifecycle') && createPortal(<div style={{ position: 'fixed', zIndex: 2147483647, left: 0, bottom: 0 }}><button onClick={() => setExited(true)}>Unmount preview</button><button onClick={() => setCharacter(previous => ({ ...previous, name: previous.name === 'scout' ? 'other' : 'scout' }))}>Switch account</button></div>, document.body)}
        {params.get('host') ? createPortal(<div className="stronghold-overlay"><AnbuVaultRaid key={`${character.name}:${props.sector}`} {...props} onVersionedCharacter={next => { if (params.get('rejectSave')) return false; setCharacter(next); return true; }} /></div>, document.body)
            : <StrongholdExplore key={`${character.name}:${props.sector}`} {...props} blocked={false} anbuAvatar="/anbu/moonshadow.webp" anbuName="The Moonshadow Anbu"
                onChallenge={() => { document.body.dataset.challenge = 'true'; }} onPatrol={session => { document.body.dataset.patrol = session.sessionId; }} />}
    </LiveCapabilitiesContext.Provider>);
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
