import { useEffect, useState } from 'react';

/** Let the outcome animation settle, then retire continuous GPU work. */
export function useBattleFrameloop(finished: boolean): 'always' | 'demand' {
    const [hidden, setHidden] = useState(() => document.hidden);
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        const update = () => setHidden(document.hidden);
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    useEffect(() => {
        // A new match can reuse its host component.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettled(false);
        if (!finished) return;
        const id = window.setTimeout(() => setSettled(true), 4500);
        return () => window.clearTimeout(id);
    }, [finished]);
    return hidden || finished && settled ? 'demand' : 'always';
}
