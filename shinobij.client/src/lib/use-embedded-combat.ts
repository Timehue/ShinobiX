import { useLayoutEffect } from 'react';
import { beginEmbeddedCombat } from './embedded-combat';

export function useEmbeddedCombat(playerName: string, active: boolean): void {
    useLayoutEffect(() => {
        if (active) return beginEmbeddedCombat(playerName);
    }, [playerName, active]);
}
