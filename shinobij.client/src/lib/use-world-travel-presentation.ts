import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPendingLocalSectorCorrection, setLocalSectorTile, subscribeLocalSectorTileCorrections } from './presence-store';
import { updateRealtimeTile } from './use-presence-socket';
import { createSectorActionGuard, createTravelPresentationScope } from './travel-presentation';
import { isContinuousWorldControlActive } from './continuous-world-control';

/** Bridges a mounted map to presence and owns its disposable travel work. */
export function useWorldTravelPresentation(name: string, initialTile: () => number, onSectorCorrection: (sector: number) => void,
    position: { sector: number; traveling: boolean }) {
    const { sector, traveling } = position;
    const [sectorPlayerPos, setSectorPlayerPos] = useState(() => getPendingLocalSectorCorrection()?.tile ?? initialTile());
    const latestPosition = useRef({ sector, traveling, tile: sectorPlayerPos });
    useLayoutEffect(() => {
        latestPosition.current = { sector, traveling, tile: sectorPlayerPos };
    }, [sector, traveling, sectorPlayerPos]);
    const getWorldPosition = useCallback(() => latestPosition.current, []);
    const travelRequestInFlight = useRef(false);
    const travelPresentation = useRef(createTravelPresentationScope());
    const captureSectorAction = useCallback((sector: number) => createSectorActionGuard(
        travelPresentation.current, getWorldPosition, () => travelRequestInFlight.current, sector,
    ), [getWorldPosition]);
    const correction = useRef(onSectorCorrection);
    useEffect(() => { correction.current = onSectorCorrection; }, [onSectorCorrection]);
    useEffect(() => {
        const scope = createTravelPresentationScope();
        travelPresentation.current = scope;
        travelRequestInFlight.current = false;
        return () => scope.dispose();
    }, [name]);
    useEffect(() => subscribeLocalSectorTileCorrections((tile, sector) => {
        setSectorPlayerPos(tile);
        if (sector !== undefined) correction.current(sector);
    }), []);
    useEffect(() => {
        setLocalSectorTile(sectorPlayerPos);
        if (!isContinuousWorldControlActive()) updateRealtimeTile(sectorPlayerPos);
    }, [sectorPlayerPos]);
    return { sectorPlayerPos, setSectorPlayerPos, travelRequestInFlight, travelPresentation, getWorldPosition, captureSectorAction };
}
