import { useEffect, useState } from 'react';

/** Track document visibility without relying on window-focus restoration. */
export function useDocumentVisible(): boolean {
    const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
    useEffect(() => {
        const update = () => setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    return visible;
}

/** Keep a live simulation running; retire its visual loop only after its result settles. */
export function battleFrameloopFor(finished: boolean, settled: boolean): 'always' | 'demand' {
    return finished && settled ? 'demand' : 'always';
}

export function useBattleFrameloop(finished: boolean): 'always' | 'demand' {
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        // A new match can reuse its host component.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettled(false);
        if (!finished) return;
        const id = window.setTimeout(() => setSettled(true), 4500);
        return () => window.clearTimeout(id);
    }, [finished]);
    return battleFrameloopFor(finished, settled);
}
