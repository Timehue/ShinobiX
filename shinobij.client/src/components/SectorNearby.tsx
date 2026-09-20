import type { WorldSectorCommandPanelProps } from './WorldSectorCommandPanel.types';
import type { SectorRosterState } from '../lib/presence-store';
import type { SectorPlayerActionState, SectorPlayerIntent } from '../lib/use-sector-player-action';
import { sectorPlayerKey } from '../lib/sector-player-roster';
import { SectorPlayerList } from './SectorPlayerList';
import { SectorSkyForecast } from './SectorSkyForecast';
import { SectorRoutes } from './SectorRoutes';

/** One complete roster, bounded by the space beneath the sector controls. */
export function SectorNearby({ sector, biome, weather, players, present, rosterState, action, onAction }:
    Pick<WorldSectorCommandPanelProps, 'sector' | 'biome' | 'weather' | 'players' | 'present'> & {
        rosterState: SectorRosterState; action: SectorPlayerActionState;
        onAction: (key: string, sector: number, intent: SectorPlayerIntent) => void;
    }) {
    const showPlayers = present && players.length > 0;
    const hasRowError = action.error && players.some(p => sectorPlayerKey(p.name) === action.error?.key);
    return <>
        <header className="sector-nearby-heading"><strong>Nearby players</strong>
            {present && rosterState === 'current' && <span>{players.length} in sector</span>}</header>
        <div className="sector-nearby-scroll" tabIndex={0} role="region" aria-label="Scroll nearby players" onWheel={event => event.stopPropagation()}>
            {(!present || rosterState !== 'current' || !players.length) && <p className="sector-roster-note" role="status">
                {!present ? 'Scouting is read only. Return here to see nearby players.' : rosterState === 'loading' ? 'Checking who is here…'
                    : rosterState === 'reconnecting' ? 'Reconnecting. Last known players are read only.' : 'No other players are here.'}
            </p>}
            {action.error && !hasRowError && <p className="sector-row-feedback" role="status">{action.error.message}</p>}
            {showPlayers ? <SectorPlayerList players={players} action={action} sector={sector} onAction={onAction} /> : <div className="sector-nearby-conditions">
                <SectorSkyForecast sector={sector} biome={biome} fallback={weather} variant="effect" />
                <SectorRoutes sector={sector} />
            </div>}
        </div>
    </>;
}
