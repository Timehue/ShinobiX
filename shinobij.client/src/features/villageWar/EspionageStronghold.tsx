import { displayPlayerName } from "../../../../shared/player-name";
import { lazy, Suspense, useEffect, useState } from 'react';
import type { Character, PlayerRecord, VersionedCharacterCommit } from '../../types/character';
import { campaignRequest, type CampaignBattle } from '../../lib/village-war-campaign';
import type { CampaignFieldMissionView } from '../../../../shared/village-war-campaign';
import { StrongholdDialog } from '../anbuInfiltration/StrongholdDialog';
import { FieldMissionSummary } from './WarFieldOrders';
import { visiblePoll } from '../../lib/poll';
import './village-campaign.css';
const Battle = lazy(() => import('./VillageCampaignBattle'));
export function EspionageStronghold({ character, warId, mission: initial, sharedImages, onVersionedCharacter, onAttackPlayer, onExit }: {
    character: Character; warId: string; mission: CampaignFieldMissionView; sharedImages: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit; onAttackPlayer: (player: PlayerRecord) => void | Promise<void>; onExit: () => void;
}) {
    const [mission, setMission] = useState(initial), [peers, setPeers] = useState<PlayerRecord[]>([]);
    const [battle, setBattle] = useState<CampaignBattle | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => {
        let alive = true;
        const update = async (action: string) => {
            try { const result = await campaignRequest(character.name, warId, action, { missionId: initial.id }); if (alive) { if (result.mission) setMission(result.mission); setPeers(result.peers ?? []); setError(''); } }
            catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Stronghold unavailable.'); }
        };
        void update('operation-enter');
        const stop = visiblePoll(() => update('operation-progress'), 3_000);
        return () => { alive = false; stop(); };
    }, [character.name, warId, initial.id]);
    async function leave() {
        if (busy) return;
        setBusy(true);
        try { await campaignRequest(character.name, warId, 'operation-leave', { missionId: initial.id }); onExit(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not leave.'); }
        finally { setBusy(false); }
    }
    async function attack(peer?: PlayerRecord) {
        if (busy) return;
        setBusy(true); setError('');
        try {
            if (peer) { await onAttackPlayer(peer); onExit(); }
            else setBattle(await campaignRequest(character.name, warId, 'start', { fieldMissionId: mission.id }));
        } catch (e) { setError(e instanceof Error ? e.message : 'Attack unavailable.'); }
        finally { setBusy(false); }
    }
    if (battle) return <Suspense fallback={<p>Preparing the sentry battle…</p>}><Battle character={character} warId={warId} run={battle} sharedImages={sharedImages}
        onVersionedCharacter={onVersionedCharacter} onBack={() => { setBattle(null); void leave(); }} /></Suspense>;
    return <StrongholdDialog title={`Enemy stronghold · Sector ${mission.sectors[0]}`} busy={busy} onClose={() => void leave()}>
        <img className='war-espionage-room-art' src='/ui/village-war/stronghold-combat-v1.webp' width={640} height={360} alt='Enemy stronghold courtyard' />
        <FieldMissionSummary mission={mission} />{error && <p role='alert'>{error}</p>}
        {!mission.insideStronghold && <p>Entering the stronghold…</p>}
        <button disabled={busy || !mission.insideStronghold || mission.status !== 'active'} onClick={() => void attack()}>Fight stronghold sentry</button>
        <h3>Players inside</h3>{!peers.some(p => p.village === mission.enemy) ? <p>No enemy players inside.</p> : peers.filter(p => p.village === mission.enemy).map(peer => <div key={peer.name} className='war-espionage-peer'><span>{displayPlayerName(peer.name)} · Level {peer.level}</span><button disabled={busy || !!peer.inBattle} onClick={() => void attack(peer)}>Attack</button></div>)}
        <button disabled={busy} onClick={() => void leave()}>Leave stronghold</button>
    </StrongholdDialog>;
}
