import { useEffect, useState } from 'react';

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
