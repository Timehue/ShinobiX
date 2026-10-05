import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Screen } from "../types/core";
import { clearNavigationTrail, previousScreen, readNavigationTrail, visitScreen, writeNavigationTrail } from './navigation-trail';
import {
    SCREEN_FIGHT_HOSTS,
    SCREEN_FIGHT_STATE_EVENT,
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
    /** Where "back" lands with no history (e.g. right after a refresh). Defaults to the village. */
    fallbackScreen?: () => Screen;
    /** A journey cannot be bypassed by returning to an earlier town screen. */
    navigationBlocked?: () => boolean;
    navigateBack?: (screen: Screen) => void;
    account?: string;
    /** A spectator exits through the same cleanup and origin as Stop watching. */
    returnOverride?: Screen;
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
    fallbackScreen,
    navigationBlocked,
    navigateBack,
    account = '',
    returnOverride,
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
    const historyRef = useRef<Screen[]>([]);
    const ownerRef = useRef('');
    useLayoutEffect(() => {
        if (screen === "start") {
            // Do not erase the saved trail during the initial boot render.
            if (ownerRef.current) clearNavigationTrail(ownerRef.current);
            ownerRef.current = '';
            historyRef.current = [];
            setScreenHistory([]);
            return;
        }
        if (ownerRef.current !== account) {
            historyRef.current = readNavigationTrail(account)?.trail ?? [];
            ownerRef.current = account;
        }
        const next = visitScreen(historyRef.current, screen);
        historyRef.current = next;
        setScreenHistory(next);
        writeNavigationTrail(account, { screen, trail: next });
    }, [screen, account]);

    const inBattleRef = useRef(false);
    // The latest signals, so an event-driven re-check (below) runs the SAME rule
    // with every signal, not just the one that changed.
    const signalsRef = useRef<BattleGuardSignals | null>(null);
    useLayoutEffect(() => {
        signalsRef.current = {
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
        };
        inBattleRef.current = isUnresolvedBattle(signalsRef.current);
    }, [screen, raidBattleKind, pvpBattleId, pvpBattleResolved, endlessBattleActive, pendingArenaStoryBattle, pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattle, arenaBattleActive, petBattleActive, missionBattleActive]);

    useEffect(() => {
        const syncTowerFightGuard = () => {
            if (screenRef.current === "battleTowers") inBattleRef.current = hasActiveTowerFight();
            if ((screenRef.current === "arenaDistrict" || screenRef.current === "worldCrisis") && signalsRef.current) inBattleRef.current = isUnresolvedBattle(signalsRef.current);
        };
        window.addEventListener(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard);
        return () => window.removeEventListener(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard);
    }, [screenRef]);

    // Same idea for a fight a screen hosts in its own state (Weekly Boss, a Card
    // Hall showdown). Scoped to those screens so a stale flag traps nobody else.
    useEffect(() => {
        const syncScreenFightGuard = () => {
            const signals = signalsRef.current;
            if (signals && SCREEN_FIGHT_HOSTS.has(signals.screen)) inBattleRef.current = isUnresolvedBattle(signals);
        };
        window.addEventListener(SCREEN_FIGHT_STATE_EVENT, syncScreenFightGuard);
        return () => window.removeEventListener(SCREEN_FIGHT_STATE_EVENT, syncScreenFightGuard);
    }, []);

    useEffect(() => {
        if (shouldRedirectToHospital(hospitalized, screen, inBattleRef.current)) setScreen("hospital");
    }, [hospitalized, screen, raidBattleKind, pvpBattleId, pvpBattleResolved, endlessBattleActive, pendingArenaStoryBattle, pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattle, arenaBattleActive, petBattleActive, missionBattleActive, setScreen]);

    const goBack = useCallback(() => {
        if (navigationBlocked?.()) return;
        if (inBattleRef.current) {
            alert("You cannot leave during a battle. Finish the fight first!");
            return;
        }
        if (hospitalized && screen === "hospital") {
            alert("You're still admitted — pay the discharge fee to be released now, or wait for the free check-out timer.");
            return;
        }
        const target = returnOverride ?? previousScreen(historyRef.current, screen, fallbackScreen?.() ?? "village");
        // Navigation is a user action, never a side effect of a React state
        // updater (StrictMode may replay those). Prune only after it commits.
        (navigateBack ?? setScreen)(target);
    }, [hospitalized, screen, setScreen, fallbackScreen, navigationBlocked, navigateBack, returnOverride]);

    return { canGoBack: !!returnOverride || previousScreen(screenHistory, screen, fallbackScreen?.() ?? "village") !== screen, goBack, inBattleRef };
}
