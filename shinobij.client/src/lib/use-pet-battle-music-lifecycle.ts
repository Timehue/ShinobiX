import { useEffect } from "react";
import type { Screen } from "../types/core";
import { stopBattleMusic } from "./pet-music";

const PET_MUSIC_SCREENS = new Set<Screen>(["petArena", "petShowdown", "petColiseum", "firstPact"]);

/** Stop the pet battle loop when navigation leaves every pet-battle surface. */
export function usePetBattleMusicLifecycle(screen: Screen): void {
    useEffect(() => {
        if (!PET_MUSIC_SCREENS.has(screen)) stopBattleMusic();
    }, [screen]);
}
