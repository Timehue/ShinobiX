import { useState } from 'react';
import type { PlayerRecord } from '../types/character';
import { useLiveSectorPlayers } from '../lib/presence-store';
import { playerSlug } from '../lib/utils';

export function ResourceNodeContest({ gatherer, selfName, onContest }: {
    gatherer: string; selfName: string; onContest?: (player: PlayerRecord) => void | Promise<void>;
}) {
    const players = useLiveSectorPlayers(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (playerSlug(selfName) === gatherer) return <p role="status">You hold this gathering claim.</p>;
    const target = players.find(player => playerSlug(player.name) === gatherer);
    return <div className="resource-node-contest">
        <p role="status"><strong>{target?.name ?? gatherer}</strong> is gathering here. Only one shinobi can gather at a time.</p>
        <p>Fight through the sector's existing PvP rules to interrupt gathering. Newcomer and recovery protection still apply.</p>
        <button type="button" className="resource-primary" disabled={busy || !target || !onContest}
            onClick={async () => {
                if (!target || !onContest || busy) return;
                setBusy(true); setError('');
                try { await onContest(target); } catch (error) { setError(error instanceof Error ? error.message : 'The fight could not start. Try again.'); }
                finally { setBusy(false); }
            }}>{busy ? 'Starting fight…' : 'Contest node'}</button>
        {!target && <p>Waiting for this shinobi's current sector presence…</p>}
        {error && <p role="alert">{error}</p>}
    </div>;
}
