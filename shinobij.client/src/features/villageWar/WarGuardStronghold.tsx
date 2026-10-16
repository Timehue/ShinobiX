import { displayPlayerName } from "../../../../shared/player-name";
import { useEffect, useState } from 'react';
import type { Character, PlayerRecord } from '../../types/character';
import { campaignRequest } from '../../lib/village-war-campaign';
import { visiblePoll } from '../../lib/poll';
import { StrongholdDialog } from '../anbuInfiltration/StrongholdDialog';
import './village-campaign.css';

export function WarGuardStronghold({ character, warId, sector, onAttackPlayer, onExit }: {
    character: Character; warId: string; sector: number;
    onAttackPlayer: (player: PlayerRecord) => void | Promise<void>; onExit: () => void;
}) {
    const [visitId] = useState(() => crypto.randomUUID());
    const [inside, setInside] = useState(false), [peers, setPeers] = useState<PlayerRecord[]>([]);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, retry] = useState(0);
    const extra = { sector, visitId };
    useEffect(() => {
        let alive = true, ready = false, pending = false;
        const update = async (action: string) => {
            if (pending) return;
            pending = true;
            try {
                const result = await campaignRequest(character.name, warId, action, { sector, visitId });
                if (alive) { ready = !!result.guard?.inside; setInside(ready); setPeers(result.peers ?? []); setError(''); }
                else if (action === 'guard-enter') void campaignRequest(character.name, warId, 'guard-leave', { sector, visitId }).catch(() => undefined);
            } catch (reason) { if (alive) { setInside(false); setError(reason instanceof Error ? reason.message : 'Guard post unavailable.'); } }
            finally { pending = false; }
        };
        void update('guard-enter');
        const stop = visiblePoll(() => ready ? update('guard-state') : Promise.resolve(), 3_000);
        return () => { alive = false; stop(); };
    }, [character.name, warId, sector, visitId, attempt]);
    async function leave() {
        if (busy) return;
        setBusy(true);
        try { await campaignRequest(character.name, warId, 'guard-leave', extra); onExit(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not leave the guard post.'); }
        finally { setBusy(false); }
    }
    async function attack(peer: PlayerRecord) {
        if (busy || !inside) return;
        setBusy(true); setError('');
        try { await onAttackPlayer(peer); onExit(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Attack unavailable.'); }
        finally { setBusy(false); }
    }
    return <StrongholdDialog title={`Guard duty · Sector ${sector}`} busy={busy} onClose={() => void leave()}>
        <img className='war-espionage-room-art' src='/ui/village-war/stronghold-combat-v1.webp' width={640} height={360} alt='Allied stronghold courtyard' />
        <p>Defend your village from enemy spies. Victories count as world-war PvP. Your allied Anbu remains on guard.</p>
        {error && <p role='alert'>{error}</p>}
        {!inside && <p>{error ? 'Reconnect to the guard post or leave.' : 'Entering the guard post…'}</p>}
        {!inside && error && <button disabled={busy} onClick={() => retry(value => value + 1)}>Reconnect guard duty</button>}
        <h3>Enemy players inside</h3>
        {inside && !peers.some(peer => peer.village !== character.village) && <p>No enemy players inside.</p>}
        {inside && peers.filter(peer => peer.village !== character.village).map(peer => <div className='war-espionage-peer' key={peer.name}>
            <span>{displayPlayerName(peer.name)} · Level {peer.level}</span><button disabled={busy || !!peer.inBattle} onClick={() => void attack(peer)}>Attack</button>
        </div>)}
        <button disabled={busy} onClick={() => void leave()}>Leave stronghold</button>
    </StrongholdDialog>;
}
