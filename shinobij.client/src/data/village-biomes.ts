import type { Biome } from "../types/core";

// Village → home-biome lookup. Extracted verbatim from App.tsx (where it was a
// local `export const`) so external callers import it from a data module
// instead of the App component file. Values unchanged.
export const villageBiomes: Record<string, Biome> = {
    "Stormveil Village": "forest",
    "Ashen Leaf Village": "volcano",
    "Frostfang Village": "snow",
    "Moonshadow Village": "shadow",
};
