/*
 * villageBiomeMap — the tiny village → home-biome lookup, split out of
 * data/storylines.ts so boot-path consumers (App.tsx) can read it without
 * statically pulling the ~270 KB story-arc prose into the entry chunk.
 * storylines.ts imports and re-exports it, so lazy story-side importers are
 * unchanged.
 */

import type { Biome } from "../types/core";

export const villageBiomeMap: Record<string, Biome> = {
    "Stormveil Village": "forest",
    "Ashen Leaf Village": "volcano",
    "Frostfang Village": "snow",
    "Moonshadow Village": "shadow",
};
