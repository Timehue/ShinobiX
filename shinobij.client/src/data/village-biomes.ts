/*
 * villageBiomeMap — the tiny village → home-biome lookup, split out of
 * data/storylines.ts so boot-path consumers (App.tsx) can read it without
 * statically pulling the ~270 KB story-arc prose into the entry chunk.
 * storylines.ts imports and re-exports it, so lazy story-side importers are
 * unchanged.
 */

import type { Biome } from "../types/core";
import { VILLAGE_OUTSKIRTS, sectorBiomeOf } from "../../../shared/sector-geo";

// A village's home biome is the biome of its gate sector. Derive it from the
// shared geography registry so village scenes, story fights, and the world map
// cannot drift away from the painted sector map assignments.
export const villageBiomeMap: Record<string, Biome> = Object.fromEntries(
    Object.entries(VILLAGE_OUTSKIRTS).map(([village, sector]) => [village, sectorBiomeOf(sector)]),
);
