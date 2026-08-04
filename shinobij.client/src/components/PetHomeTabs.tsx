/* eslint-disable react-refresh/only-export-components -- the session routing helper is tested with the tabs */
import type { Screen } from "../types/core";

export type PetHomeTab = "collection" | "yard" | "sanctuary" | "breeding";

export type PetHomeContentTab = Exclude<PetHomeTab, "yard">;

const HOME_TAB_HINT = "shinobix:pet-home-tab";

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
            <button type="button" aria-current={active === "collection" ? "page" : undefined} onClick={() => openHomeTab("collection", onHomeTab, setScreen)}>Collection</button>
            <button type="button" aria-current={active === "yard" ? "page" : undefined} onClick={() => setScreen("pets")}>Pet Yard</button>
            <button type="button" aria-current={active === "sanctuary" ? "page" : undefined} onClick={() => openHomeTab("sanctuary", onHomeTab, setScreen)}>Sanctuary</button>
            <button type="button" aria-current={active === "breeding" ? "page" : undefined} onClick={() => openHomeTab("breeding", onHomeTab, setScreen)}>Breeding Barn</button>
        </nav>
    );
}
