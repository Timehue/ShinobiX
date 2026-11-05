import { memo } from 'react';
import type { SectorExit } from '../../../shared/sector-links';
import { sectorName } from '../../../shared/sector-geo';
import { isWalkableTile } from '../../../shared/sector-walk-mask';

export type ContinuousWorldTilesProps = { sector: number; playerTile: number; onPainting: boolean; ready: boolean;
    roadExits: readonly SectorExit[]; go: (sector: number, tile: number) => void };

/**
 * The continuous sector's 144 tap targets. Every input is a primitive, the
 * per-sector constant exit list (shared/sector-links `sectorExits`) or
 * ContinuousWorldSector's stable `go`, so a parent render that changes none of
 * them (App's one-second idle-regen tick, a HUD update) skips reconciling all
 * 144 buttons. Markup is unchanged from when it was inline.
 */
export const ContinuousWorldTiles = memo(function ContinuousWorldTiles({ sector, playerTile, onPainting, ready, roadExits, go }: ContinuousWorldTilesProps) {
    return <>{Array.from({ length: 144 }, (_, tile) => <button key={tile} type="button" tabIndex={tile === playerTile ? 0 : -1}
        className={`scene-tile continuous-world-tile${tile === playerTile && onPainting ? ' sector-player-tile' : ''}`}
        disabled={!ready} aria-label={roadExits.some(e => e.tile === tile)
            ? `Cross to ${sectorName(roadExits.find(e => e.tile === tile)!.destinationSector)}`
            : `${tile === playerTile ? 'Current tile' : isWalkableTile(sector, tile) ? 'Move to tile' : 'Move near blocked tile'} row ${Math.floor(tile / 12) + 1} column ${tile % 12 + 1}`}
        onClick={() => {
            const exit = roadExits.find(e => e.tile === tile);
            go(exit?.destinationSector ?? sector, exit?.destinationTile ?? tile);
        }} />)}</>;
});
