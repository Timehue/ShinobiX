import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { SectorExit } from '../../../shared/sector-links';

/** A crossing is a destination for a walk, never a timer or a guessed distance. */
export function createRoadApproach() {
    let pending: SectorExit | null = null;
    let settled: { sector: number; tile: number } | null = null;
    const take = () => {
        if (!pending || pending.sector !== settled?.sector || pending.tile !== settled.tile) return null;
        const exit = pending; pending = null; return exit;
    };
    return {
        request(exit: SectorExit) { pending = exit; return take(); },
        arrive(sector: number, tile: number) { settled = { sector, tile }; return take(); },
        cancel() { pending = null; },
        depart() { settled = null; },
        reset() { pending = null; settled = null; },
    };
}

/** Keep mouse, touch and keyboard exits behind the same actual-avatar arrival. */
export function useSectorRoadWalk(sector: number | null, targetTile: number,
    setTile: Dispatch<SetStateAction<number>>, cross: (exit: SectorExit) => void, busy: () => boolean) {
    const approach = useRef(createRoadApproach());
    useLayoutEffect(() => {
        const route = approach.current;
        route.reset();
        return () => route.reset();
    }, [sector]);
    useLayoutEffect(() => { approach.current.depart(); }, [targetTile]);
    const selectTile = useCallback<Dispatch<SetStateAction<number>>>((tile) => {
        approach.current.cancel();
        if (!busy()) setTile(tile);
    }, [busy, setTile]);
    const requestExit = useCallback((exit: SectorExit) => {
        if (busy() || sector !== exit.sector) return;
        // A prior settled position is valid only while it is still our target.
        if (targetTile !== exit.tile) approach.current.reset();
        const ready = approach.current.request(exit);
        setTile(exit.tile);
        if (ready) cross(ready);
    }, [busy, sector, targetTile, setTile, cross]);
    const arriveAtTile = useCallback((tile: number, arrivedSector: number | null) => {
        if (arrivedSector !== sector || sector === null || tile !== targetTile) return;
        const exit = approach.current.arrive(sector, tile);
        if (exit && !busy()) cross(exit);
    }, [busy, sector, targetTile, cross]);
    return { selectTile, requestExit, arriveAtTile };
}
