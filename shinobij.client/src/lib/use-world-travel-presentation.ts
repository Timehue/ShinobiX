import { useEffect, useRef, useState } from 'react';
import { getPendingLocalSectorCorrection, setLocalSectorTile, subscribeLocalSectorTileCorrections } from './presence-store';
import { updateRealtimeTile } from './use-presence-socket';
import { createTravelPresentationScope } from './travel-presentation';

/** Bridges a mounted map to presence and owns its disposable travel work. */
export function useWorldTravelPresentation(name: string, initialTile: () => number, onSectorCorrection: (sector: number) => void) {
    const [sectorPlayerPos, setSectorPlayerPos] = useState(() => getPendingLocalSectorCorrection()?.tile ?? initialTile());
    const travelRequestInFlight = useRef(false);
    const travelPresentation = useRef(createTravelPresentationScope());
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
        updateRealtimeTile(sectorPlayerPos);
    }, [sectorPlayerPos]);
    return { sectorPlayerPos, setSectorPlayerPos, travelRequestInFlight, travelPresentation };
}
