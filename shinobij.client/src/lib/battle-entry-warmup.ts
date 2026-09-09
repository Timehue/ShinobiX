import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { isAcademyOnboardingActive } from "./onboarding-step";

const COMBAT_ENTRY_SCREENS = new Set<Screen>([
    "worldMap", "arenaDistrict", "arena", "battleTowers", "villageWar", "villageWarMap", "clanWar2v2",
]);

/** Warm likely combat entry without competing with restoration or the Academy.
 * An actual PvP restore/launch still gets its screen and art immediately. */
export function battleEntryWarmupDelay({ screen, hasCharacter, restoringSession, onboardingStep, saveData }: {
    screen: Screen;
    hasCharacter: boolean;
    restoringSession: boolean;
    onboardingStep: Character["onboardingStep"];
    saveData: boolean;
}): number | null {
    if (screen === "pvpBattle") return 0;
    if (!hasCharacter || restoringSession || saveData || isAcademyOnboardingActive(onboardingStep)) return null;
    return COMBAT_ENTRY_SCREENS.has(screen) ? 650 : null;
}
