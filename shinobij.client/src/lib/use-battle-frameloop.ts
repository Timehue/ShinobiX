import { useEffect, useState } from 'react';

/** Track document visibility for decorative canvases only. */
export function useDocumentVisible(): boolean {
    const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
    useEffect(() => {
        const update = () => setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    return visible;
}

/** Let the outcome animation settle, then retire continuous GPU work. */
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
