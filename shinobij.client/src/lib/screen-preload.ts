/*
 * Intent-based screen prefetch for the nav menus (RightMenu / MobileNav).
 *
 * Every game screen is a lazyWithRetry() dynamic import (see App.tsx), so the
 * FIRST time a screen is opened the browser must download + parse its chunk
 * (100–400 KB for the heavy ones) before it can paint. This warms that chunk on
 * pointer-DOWN — the press, ~100–300 ms before the click's navigate() fires — so
 * by the time the screen mounts there is usually nothing left to fetch.
 *
 * Why this is zero-downside:
 *  - Press, not hover: we only ever warm the button actually being activated, so
 *    there are no speculative/wasted downloads from a mouse sweeping the menu.
 *  - Same chunk, not a duplicate: each specifier below resolves to the exact same
 *    file App.tsx lazy-imports, so Vite/Rollup dedupe them into one chunk — the
 *    warm-up is a cache hit for the real <Suspense> render, never a second fetch.
 *  - Pure module warming: importing a screen module just defines its component
 *    (no network writes, no side effects) — identical to what the click does a
 *    moment later. Best-effort: any failure is swallowed and the click still
 *    triggers the normal lazyWithRetry load path.
 *
 * The literal import() strings must stay in sync with App.tsx's lazy declarations
 * so both sides resolve to the same module. A stale entry can't break navigation
 * — it just silently stops helping for that screen (the real lazy import still
 * runs on click).
 */
import type { Screen } from "../types/core";

// nav Screen name → the module App.tsx lazy-loads that screen from. Only the
// screens reachable from the nav menus are listed; anything else is a no-op.
const SCREEN_PRELOADERS: Partial<Record<Screen, () => Promise<unknown>>> = {
    worldMap: () => import("../screens/WorldMap"),
    tavern: () => import("../screens/VillageTavern"),
    userHub: () => import("../screens/UserHub"),
    messages: () => import("../screens/Messages"),
    missions: () => import("../screens/Missions"),
    training: () => import("../screens/Training"),
    jutsuTraining: () => import("../screens/Training"), // shares Training.tsx
    profile: () => import("../screens/Profile"),
    inventory: () => import("../screens/Inventory"),
    pets: () => import("../screens/PetYard"),
    bloodlineMaker: () => import("../screens/BloodlineMaker"),
    professions: () => import("../screens/Professions"),
    logbook: () => import("../screens/Logbook"),
    guides: () => import("../components/GuidesLibrary"),
    adminPanel: () => import("../screens/AdminPanel"),
    adminLogin: () => import("../screens/AdminLogin"),
};

/**
 * Best-effort warm of a screen's lazy chunk. Safe to call on every pointer-down;
 * a repeat call after the chunk is cached is a cheap no-op. Never throws.
 */
export function preloadScreen(screen: Screen): void {
    const load = SCREEN_PRELOADERS[screen];
    if (!load) return;
    try {
        void load().catch(() => {
            /* best-effort: the click's own lazy import will retry on real use */
        });
    } catch {
        /* best-effort */
    }
}
