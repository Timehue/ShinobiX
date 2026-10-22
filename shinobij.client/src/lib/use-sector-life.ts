import { useEffect, useState } from 'react';
import type { LifeSceneView } from '../../../shared/sector-life';
import { isPlayableWildSector } from '../../../shared/sector-geo';
import { requestSectorLife } from './sector-life-api';
import { isCoveredByCombat, subscribeCombatCover } from './combat-cover';
import {acceptLifeScene} from './sector-life-cache';

/** One bounded visible-sector poll. Hidden tabs, battles and removed scenes do no work. */
export function useSectorLife(player: string, sector: number) {
    const [entry, setEntry] = useState<{ sector: number; player: string; view: LifeSceneView }> ();
    const [error, setError] = useState('');
    const accept = (view: LifeSceneView) => setEntry(previous => {
        const current=previous?.sector===sector&&previous.player===player?previous.view:undefined,next=acceptLifeScene(current,view);
        return previous&&current===next?previous:{sector,player,view:next};
    });
    useEffect(() => {
        if (!isPlayableWildSector(sector)) return;
        let alive = true, timer = 0, revision = 0, pending: AbortController | undefined;
        const stop = () => { revision++; window.clearTimeout(timer); pending?.abort(); };
        const load = async () => {
            if (!alive || document.hidden || isCoveredByCombat()) return;
            const request = ++revision;
            pending = new AbortController();
            try {
                const result = await requestSectorLife(player, sector, pending.signal);
                if (alive && request === revision && result.ok && result.view) { accept(result.view); setError(''); }
            } catch { /* Removal and visibility changes abort quietly. */ }
            if (alive && request === revision && !document.hidden && !isCoveredByCombat()) timer = window.setTimeout(load, 20_000);
        };
        const visibility = () => { stop(); if (!document.hidden && !isCoveredByCombat()) void load(); };
        document.addEventListener('visibilitychange', visibility);
        const unbind = subscribeCombatCover(visibility); void load();
        return () => { alive = false; stop(); unbind(); document.removeEventListener('visibilitychange', visibility); };
        // The acceptance closure belongs to this player/sector pair; it merges
        // monotonic stages so an older GET cannot undo a completed action.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [player, sector]);
    return { view: entry?.sector === sector && entry.player === player ? entry.view : undefined, error,
        async act(view: LifeSceneView) {
            const result = await requestSectorLife(player, sector, undefined, { window: view.window, step: view.step });
            if (result.ok && result.view) { accept(result.view); setError(''); }
            else {
                setError(result.error ?? 'The activity has changed. Check it again.');
                const current = await requestSectorLife(player, sector);
                if (current.ok && current.view) accept(current.view);
            }
            return result;
        } };
}
