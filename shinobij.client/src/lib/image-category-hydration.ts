import { useEffect, useRef } from "react";
import type { Screen } from "../types/core";
import { useCombatCover } from "./combat-cover";

/*
 * Which shared-image buckets the current context needs.
 *
 * `imageCategoriesForScreen` keys off App's `screen`, and that is structurally
 * blind to combat: AiFightHost and StoryBossFightHost are mounted
 * unconditionally and render the fight as a body portal, so `screen` never
 * changes when one opens — the same fact AiFightHost's `onFightOpenChange` prop
 * exists for. A fight therefore ran on whatever the launching screen happened to
 * have loaded, and `missions` is `["ai"]`, so a solo mission fight's jutsu and
 * item cards showed the fallback glyph unless some earlier screen had already
 * hydrated those buckets. Key the combat set off the fight's own DOM cover
 * signal instead of any screen's entry.
 */

/**
 * `jutsu:` and `item:` are the action cards, `ai:` the enemy portrait and
 * battlefield sprite, `pet:` the summoned companion's orb. `avatar:` is already
 * warmed at login and bloodline jutsu art rides the `jutsu` bucket's patch, so
 * neither is repeated here. All four are URL-mode manifests — a few KB of
 * {id: url} — and the bytes still load lazily per `<img>`.
 */
export const COMBAT_IMAGE_CATEGORIES = ["jutsu", "item", "ai", "pet"] as const;

/**
 * Owns every "hydrate the buckets this context can render" effect. The loaders
 * are read through a ref so only the real triggers — the screen, an open
 * triggered event, and the fight cover — sit in the dependency arrays.
 */
export function useImageCategoryHydration(
    loadScreenImageCategories: (screen: Screen) => void,
    loadCategory: (category: string) => unknown,
    screen: Screen,
    activeTriggeredEvent: unknown,
): void {
    const latest = useRef({ loadScreenImageCategories, loadCategory });
    useEffect(() => { latest.current = { loadScreenImageCategories, loadCategory }; });
    const coveredByCombat = useCombatCover();
    useEffect(() => { latest.current.loadScreenImageCategories(screen); }, [screen]);
    useEffect(() => { if (activeTriggeredEvent) void latest.current.loadCategory("event"); }, [activeTriggeredEvent]);
    useEffect(() => {
        if (!coveredByCombat) return;
        for (const category of COMBAT_IMAGE_CATEGORIES) void latest.current.loadCategory(category);
    }, [coveredByCombat]);
}
