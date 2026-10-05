import type { Screen } from "../types/core";

// The Grand Marketplace lists its scroll cards below every item group, so the
// backpack's "Use scroll" hand-off leaves a one-shot hint naming the card to
// bring into view instead of landing the player at the top of the stock.
const MARKETPLACE_SCROLL_HINT = "shinobix:marketplace-scroll:v1";

export type MarketplaceScrollCard = "village" | "profession";

export function openMarketplaceScroll(card: MarketplaceScrollCard, setScreen: (screen: Screen) => void): void {
    try { window.sessionStorage.setItem(MARKETPLACE_SCROLL_HINT, card); } catch { /* navigation still works */ }
    setScreen("grandMarketplace");
}

/** Reads and clears the hint, so only the visit the backpack opened jumps to the card. */
export function takeMarketplaceScrollHint(): MarketplaceScrollCard | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.sessionStorage.getItem(MARKETPLACE_SCROLL_HINT);
        window.sessionStorage.removeItem(MARKETPLACE_SCROLL_HINT);
        return value === "village" || value === "profession" ? value : null;
    } catch {
        return null;
    }
}
