import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Screen } from "../types/core";
import {
    TOWER_FIGHT_STATE_EVENT,
    hasActiveTowerFight,
    isUnresolvedBattle,
    shouldRedirectToHospital,
    type BattleGuardSignals,
} from "./screen-guards";

/* eslint-disable react-hooks/set-state-in-effect */

interface BattleNavigationGuardOptions extends Omit<BattleGuardSignals, "screen"> {
    screen: Screen;
    screenRef: { current: Screen };
    hospitalized: boolean;
    setScreen: Dispatch<SetStateAction<Screen>>;
}

/**
 * Owns the App shell's navigation history and unresolved-battle lock.
 * Mixed lobby/fight screens remain free in their lobby state, while Tower's
 * same-tab state event synchronously closes the global navigation escape hatch.
 */
export function useBattleNavigationGuard({
    screen,
    screenRef,
    hospitalized,
    setScreen,
    raidBattleKind,
    pvpBattleId,
    pvpBattleResolved,
    endlessBattleActive,
    pendingArenaStoryBattle,
    pendingEventEncounter,
    activeDungeonEvent,
    hollowGateTileGameActive,
    pendingPetBattle,
    arenaBattleActive,
    petBattleActive,
    missionBattleActive,
}: BattleNavigationGuardOptions) {
    const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
    const isGoingBackRef = useRef(false);

    useEffect(() => {
        if (isGoingBackRef.current) {
            isGoingBackRef.current = false;
            return;
        }
        if (screen === "start") {
            setScreenHistory([]);
            return;
        }
        setScreenHistory(previous => {
            if (previous[previous.length - 1] === screen) return previous;
            return [...previous.slice(-19), screen];
        });
    }, [screen]);

    const inBattleRef = useRef(false);
    useEffect(() => {
        inBattleRef.current = isUnresolvedBattle({
            screen,
            raidBattleKind,
            pvpBattleId,
            pvpBattleResolved,
            endlessBattleActive,
            pendingArenaStoryBattle,
            pendingEventEncounter,
            activeDungeonEvent,
            hollowGateTileGameActive,
            pendingPetBattle,
            arenaBattleActive,
            petBattleActive,
            missionBattleActive,
        });
    }, [screen, raidBattleKind, pvpBattleId, pvpBattleResolved, endlessBattleActive, pendingArenaStoryBattle, pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattle, arenaBattleActive, petBattleActive, missionBattleActive]);

    useEffect(() => {
        const syncTowerFightGuard = () => {
            if (screenRef.current === "battleTowers") inBattleRef.current = hasActiveTowerFight();
        };
        window.addEventListener(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard);
        return () => window.removeEventListener(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard);
    }, [screenRef]);

    useEffect(() => {
        if (shouldRedirectToHospital(hospitalized, screen, inBattleRef.current)) setScreen("hospital");
    }, [hospitalized, screen, raidBattleKind, pvpBattleId, pvpBattleResolved, endlessBattleActive, pendingArenaStoryBattle, pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattle, arenaBattleActive, petBattleActive, missionBattleActive, setScreen]);

    const goBack = useCallback(() => {
        if (inBattleRef.current) {
            alert("⚔️ You cannot leave during a battle. Finish the fight first!");
            return;
        }
        if (hospitalized && screen === "hospital") {
            alert("🏥 You're still admitted — pay the discharge fee to be released now, or wait for the free check-out timer.");
            return;
        }
        setScreenHistory(previous => {
            if (previous.length <= 1) {
                setScreen("village");
                return previous;
            }
            isGoingBackRef.current = true;
            setScreen(previous[previous.length - 2]);
            return previous.slice(0, -1);
        });
    }, [hospitalized, screen, setScreen]);

    return { canGoBack: screenHistory.length > 1, goBack, inBattleRef };
}
