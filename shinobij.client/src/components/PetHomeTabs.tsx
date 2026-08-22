/* eslint-disable react-refresh/only-export-components -- the session routing helper is tested with the tabs */
import type { Screen } from "../types/core";
import { GameIcon } from "./icons/GameIcon";

export type PetHomeTab = "collection" | "yard" | "arena" | "sanctuary" | "breeding";

export type PetHomeContentTab = Exclude<PetHomeTab, "yard" | "arena">;

const HOME_TAB_HINT = "shinobix:pet-home-tab";

function PetHomeTabLabel({ full, short }: { full: string; short: string }) {
    return (
        <span className="pet-home-tab-label">
            <span className="pet-home-tab-label-full">{full}</span>
            <span className="pet-home-tab-label-short" aria-hidden="true">{short}</span>
        </span>
    );
}

export function takePetHomeTabHint(): PetHomeContentTab {
    if (typeof window === "undefined") return "collection";
    try {
        const value = window.sessionStorage.getItem(HOME_TAB_HINT);
        window.sessionStorage.removeItem(HOME_TAB_HINT);
        return value === "sanctuary" || value === "breeding" ? value : "collection";
    } catch { return "collection"; }
}

function openHomeTab(tab: PetHomeContentTab, onHomeTab: ((tab: PetHomeContentTab) => void) | undefined, setScreen: (screen: Screen) => void) {
    if (onHomeTab) return onHomeTab(tab);
    try { window.sessionStorage.setItem(HOME_TAB_HINT, tab); } catch { /* UI routing hint only. */ }
    setScreen("home");
}

export function PetHomeTabs({ active, onHomeTab, setScreen }: {
    active: PetHomeTab;
    onHomeTab?: (tab: PetHomeContentTab) => void;
    setScreen: (screen: Screen) => void;
}) {
    return (
        <nav className="pet-home-tabs" aria-label="Companion Home sections">
            <button type="button" aria-label="Collection" aria-current={active === "collection" ? "page" : undefined} onClick={() => openHomeTab("collection", onHomeTab, setScreen)}><GameIcon name="medal" /><PetHomeTabLabel full="Collection" short="Roster" /></button>
            <button type="button" aria-label="Pet Yard" aria-current={active === "yard" ? "page" : undefined} onClick={() => setScreen("pets")}><GameIcon name="paw" /><PetHomeTabLabel full="Pet Yard" short="Yard" /></button>
            <button type="button" aria-label="Pet Arena" aria-current={active === "arena" ? "page" : undefined} onClick={() => setScreen("petArena")}><GameIcon name="sword" /><PetHomeTabLabel full="Pet Arena" short="Arena" /></button>
            <button type="button" aria-label="Sanctuary" aria-current={active === "sanctuary" ? "page" : undefined} onClick={() => openHomeTab("sanctuary", onHomeTab, setScreen)}><GameIcon name="shield" /><PetHomeTabLabel full="Sanctuary" short="Sanctuary" /></button>
            <button type="button" aria-label="Breeding Barn" aria-current={active === "breeding" ? "page" : undefined} onClick={() => openHomeTab("breeding", onHomeTab, setScreen)}><GameIcon name="sparkle" /><PetHomeTabLabel full="Breeding Barn" short="Breed" /></button>
        </nav>
    );
}
