import { useCallback, useEffect, useState } from 'react';
import type { WorldSectorCommandPlayer } from './WorldSectorCommandPanel.types';
import type { SectorPlayerActionState, SectorPlayerIntent } from '../lib/use-sector-player-action';
import { sectorPlayerKey } from '../lib/sector-player-roster';
import { SectorPlayerRow } from './SectorPlayerRow';

const ROW_BATCH = 16;

/** Paint the visible rows immediately. Large rosters append in frame-sized
 * batches instead of blocking input; every row remains mounted once shown. */
export function SectorPlayerList({ players, action, sector, onAction }: {
    players: readonly WorldSectorCommandPlayer[]; action: SectorPlayerActionState;
    sector: number; onAction: (key: string, sector: number, intent: SectorPlayerIntent) => void;
}) {
    const [limit, setLimit] = useState(ROW_BATCH);
    useEffect(() => {
        if (limit >= players.length) return;
        const frame = requestAnimationFrame(() => setLimit(current => current + ROW_BATCH));
        return () => cancelAnimationFrame(frame);
    }, [limit, players.length]);
    const run = useCallback((key: string, intent: SectorPlayerIntent) => onAction(key, sector, intent), [onAction, sector]);
    return <ul className="sector-roster-list" aria-label="Sector players" aria-busy={limit < players.length}>
        {players.slice(0, limit).map(player => <SectorPlayerRow key={sectorPlayerKey(player.name)} player={player}
            pending={action.pending === sectorPlayerKey(player.name)} busy={action.pending !== null}
            error={action.error?.key === sectorPlayerKey(player.name) ? action.error.message : undefined}
            onAction={run} />)}
    </ul>;
}
