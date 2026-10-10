import { useEffect, useState } from "react";
import { OPEN_SECTOR_BATTLE_EVENT } from "./sector-war-engagement";

/**
 * A number that changes whenever a new open-world battle is stashed for this
 * contest screen while it is already showing. The screen keys its battle on it,
 * so the battle remounts and reads the new stash. App does not remount a screen
 * it is asked to show again, and without this a player still on the Pet or Card
 * screen (a table duel, or an earlier open battle) never saw the battle they
 * were just drawn into (lib/sector-war-engagement.ts beginOpenSectorBattle).
 */
export function useOpenSectorBattleGeneration(stashKey: string): number {
    const [generation, setGeneration] = useState(0);
    useEffect(() => {
        const onBattle = (event: Event) => {
            if ((event as CustomEvent<unknown>).detail === stashKey) setGeneration((n) => n + 1);
        };
        window.addEventListener(OPEN_SECTOR_BATTLE_EVENT, onBattle);
        return () => window.removeEventListener(OPEN_SECTOR_BATTLE_EVENT, onBattle);
    }, [stashKey]);
    return generation;
}
