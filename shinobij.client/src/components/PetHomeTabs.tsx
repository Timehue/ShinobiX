/* eslint-disable react-refresh/only-export-components -- the session routing helper is tested with the tabs */
import type { Screen } from "../types/core";
import collectionArt from "../assets/pet-home/tabs/collection.webp";
import yardArt from "../assets/pet-home/tabs/yard.webp";
import arenaArt from "../assets/pet-home/tabs/arena.webp";
import sanctuaryArt from "../assets/pet-home/tabs/sanctuary.webp";
import hatcheryArt from "../assets/pet-home/tabs/hatchery.webp";

export type PetHomeTab = "collection" | "yard" | "arena" | "sanctuary" | "breeding";

export type PetHomeContentTab = Exclude<PetHomeTab, "yard" | "arena">;

const HOME_TAB_HINT = "shinobix:pet-home-tab";

export function setPetHomeTabHint(tab: PetHomeContentTab): void {
    try { window.sessionStorage.setItem(HOME_TAB_HINT, tab); } catch { /* UI routing hint only. */ }
}

function PetHomeTabLabel({ full, short }: { full: string; short: string }) {
    return (
        <span className="pet-home-tab-label">
            <span className="pet-home-tab-label-full">{full}</span>
            <span className="pet-home-tab-label-short" aria-hidden="true">{short}</span>
        </span>
    );
}

const PET_HOME_DESTINATIONS: ReadonlyArray<{
    id: PetHomeTab;
    full: string;
    short: string;
    detail: string;
    art: string;
}> = [
    { id: "collection", full: "Collection", short: "Collection", detail: "Browse your roster", art: collectionArt },
    { id: "yard", full: "Pet Yard", short: "Yard", detail: "Train and equip", art: yardArt },
    { id: "arena", full: "Pet Arena", short: "Arena", detail: "Enter the ring", art: arenaArt },
    { id: "sanctuary", full: "Sanctuary", short: "Sanctuary", detail: "Manage capacity", art: sanctuaryArt },
    { id: "breeding", full: "Shinobi Hatchery", short: "Hatchery", detail: "Raise a new bond", art: hatcheryArt },
];

export function peekPetHomeTabHint(): PetHomeContentTab {
    if (typeof window === "undefined") return "collection";
    try {
        const value = window.sessionStorage.getItem(HOME_TAB_HINT);
        return value === "sanctuary" || value === "breeding" ? value : "collection";
    } catch { return "collection"; }
}

export function clearPetHomeTabHint(): void {
    try { window.sessionStorage.removeItem(HOME_TAB_HINT); } catch { /* UI routing hint only. */ }
}

function openHomeTab(tab: PetHomeContentTab, onHomeTab: ((tab: PetHomeContentTab) => void) | undefined, setScreen: (screen: Screen) => void) {
    if (onHomeTab) return onHomeTab(tab);
    setPetHomeTabHint(tab);
    setScreen("home");
}

export function PetHomeTabs({ active, onHomeTab, setScreen }: {
    active: PetHomeTab;
    onHomeTab?: (tab: PetHomeContentTab) => void;
    setScreen: (screen: Screen) => void;
}) {
    const openTab = (tab: PetHomeTab) => {
        if (tab === "yard") setScreen("pets");
        else if (tab === "arena") setScreen("petArena");
        else openHomeTab(tab, onHomeTab, setScreen);
    };

    return (
        <nav className="pet-home-tabs" aria-label="Companion Home sections">
            {PET_HOME_DESTINATIONS.map((tab) => <button
                key={tab.id}
                type="button"
                aria-label={tab.full}
                aria-current={active === tab.id ? "page" : undefined}
                onClick={() => openTab(tab.id)}
            >
                <img className="pet-home-tab-art" src={tab.art} alt="" aria-hidden="true" draggable={false} />
                <span className="pet-home-tab-copy">
                    <PetHomeTabLabel full={tab.full} short={tab.short} />
                    <span className="pet-home-tab-detail" aria-hidden="true">{tab.detail}</span>
                </span>
            </button>)}
        </nav>
    );
}
