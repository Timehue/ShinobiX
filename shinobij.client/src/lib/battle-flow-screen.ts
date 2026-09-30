import type { Screen } from "../types/core";
import { BATTLE_SCREENS } from "./screen-guards";

// Sealed story/AI fights render in a body portal without changing `screen`, so
// callers supply the battle signal and presence check alongside the screen.
export function isBattleFlowScreen(
    screen: Screen,
    sealedFightOnScreen: boolean,
    sealedFightEngaged: boolean,
    isPresenceBattleActive: () => boolean,
): boolean {
    return sealedFightOnScreen || sealedFightEngaged
        || BATTLE_SCREENS.has(screen)
        || screen === "sectorPet"
        || screen === "clanWarPet"
        || isPresenceBattleActive();
}
