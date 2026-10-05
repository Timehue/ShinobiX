import type { Screen } from "../types/core";
import { useLayoutEffect, useRef, useState } from 'react';
import { readNavigationTrail } from './navigation-trail';
import { isWildSector, safeFallbackScreen } from './screen-guards';

export function usePetHomeReturn(screen: Screen, account: string | undefined, sector: number): Screen {
    const [target, setTarget] = useState<Screen>('village');
    const previous = useRef<Screen>('start');
    useLayoutEffect(() => {
        if (isPetHomeScreen(screen) && !isPetHomeScreen(previous.current)) {
            const trail = account ? readNavigationTrail(account)?.trail : undefined;
            const origin = previous.current !== 'start' ? previous.current : trail?.filter(candidate => !isPetHomeScreen(candidate)).at(-1);
            setTarget(origin ?? safeFallbackScreen(isWildSector(sector)));
        }
        previous.current = screen;
    }, [account, screen, sector]);
    return target;
}

const PET_HOME_SCREENS: ReadonlySet<Screen> = new Set([
    "home",
    "pets",
    "petArena",
    "petShowdown",
    "petColiseum",
    "petLadder",
]);

/** Companion screens behave as one destination, even while their internal tab changes. */
export function isPetHomeScreen(screen: Screen): boolean {
    return PET_HOME_SCREENS.has(screen);
}

export function petHomeReturnLabel(screen: Screen): string {
    const labels: Partial<Record<Screen, string>> = {
        arena: "Battle Arena",
        arenaDistrict: "Arena District",
        centralHub: "Central",
        clan: "Clan Hall",
        hollowGateShrine: "Hollow Gate Shrine",
        village: "Village",
        worldMap: "World Map",
    };
    return labels[screen] ?? "Previous Location";
}
