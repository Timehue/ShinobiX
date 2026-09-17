/*
 * combat-cover — "is a body-portaled fight covering the page right now?"
 *
 * Every live shinobi fight (solo PvE, PvP, Towers) renders through
 * CombatInstance, a fixed full-viewport layer portaled straight under <body>.
 * The screen that launched it stays mounted underneath, so its decorative frame
 * loops (the sector ambience canvas, the critters, the two WebGL depth scenes)
 * keep drawing frames nobody can see, and the compositor keeps re-presenting
 * the launching screen's glass panels on every frame the fight animates.
 *
 * This module is the one DOM-level signal those loops pause on. It watches only
 * the direct children of <body> (portals mount and unmount there), so the
 * observer costs nothing between fights, and it re-reads the DOM rather than
 * trusting any counter, so a fight that unmounts for ANY reason always resumes
 * the loops. React never owns this state: `useCombatCover` is a
 * useSyncExternalStore view of the same DOM fact.
 *
 * PRESENTATION ONLY. Nothing here changes what a fight does or shows; it only
 * stops work that is happening behind an opaque, fixed overlay.
 */
import { useSyncExternalStore } from "react";

/** The fight boundary's root, as CombatInstance renders it. */
export const COMBAT_COVER_SELECTOR = "body > .combat-instance";

/** Pure: does this root currently hold a fight boundary as a direct child of <body>? */
export function combatCoverPresent(root: ParentNode | null | undefined): boolean {
    if (!root || typeof root.querySelector !== "function") return false;
    try {
        return root.querySelector(COMBAT_COVER_SELECTOR) !== null;
    } catch {
        return false;
    }
}

let observer: MutationObserver | null = null;
let covered = false;
const listeners = new Set<() => void>();

function read(): boolean {
    return typeof document !== "undefined" && combatCoverPresent(document);
}

function ensureObserver(): void {
    if (observer) return;
    if (typeof document === "undefined" || typeof MutationObserver === "undefined" || !document.body) return;
    covered = read();
    observer = new MutationObserver(() => {
        const next = read();
        if (next === covered) return;
        covered = next;
        for (const listener of listeners) listener();
    });
    observer.observe(document.body, { childList: true });
}

/** True while a fight boundary is mounted under <body>. SSR-safe (false). */
export function isCoveredByCombat(): boolean {
    ensureObserver();
    return observer ? covered : read();
}

/** Notified whenever the cover appears or disappears. Returns the unsubscribe. */
export function subscribeCombatCover(listener: () => void): () => void {
    ensureObserver();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** React view of the same fact, for components that switch a frame loop off. */
export function useCombatCover(): boolean {
    return useSyncExternalStore(subscribeCombatCover, isCoveredByCombat, () => false);
}
