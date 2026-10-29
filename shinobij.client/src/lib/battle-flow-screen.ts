import type { Screen } from "../types/core";
import { BATTLE_SCREENS } from "./screen-guards";

/** A visible clan host has already admitted this challenge, including after a
 * reload. A lagging war-list response must not launch it again on exit. */
export function visibleClanWarChallengeId(screen: Screen, readStash = () => sessionStorage.getItem("clanWarChallenge.v1"), pvpContext?: { mode?: string; clanWarChallengeId?: string } | null): string | null {
    if (screen === "pvpBattle") return pvpContext?.mode === "clanWar1v1" ? pvpContext.clanWarChallengeId || null : null;
    if (screen !== "clanWarPet" && screen !== "clanWar2v2" && screen !== "tilecardsDuel") return null;
    try {
        const id: unknown = JSON.parse(readStash() ?? "{}").challengeId;
        return typeof id === "string" && id ? id : null;
    } catch { return null; }
}

/** A pet replay still owns its route binding even though its server result is
 * already settled. Do not replace that binding with another accepted match. */
export function blocksClanWarAutoLaunch(screen: Screen, petBattleActive: boolean, towerBattleActive: boolean): boolean {
    const mixedPetScreen = screen === "petArena" || screen === "petColiseum" || screen === "petLadder";
    const battleScreen = BATTLE_SCREENS.has(screen) || screen === "clanWarPet" || screen === "sectorPet";
    return (battleScreen && (!mixedPetScreen || petBattleActive) && (screen !== "battleTowers" || towerBattleActive))
        || (screen === "arenaDistrict" && towerBattleActive);
}

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
