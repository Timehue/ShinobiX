/*
 * Per-village facility emblem icons — a painted crest per facility, palette-matched
 * to each village's painted background (Frostfang icy, Stormveil storm, Ashen Leaf
 * forest, Moonshadow night). Bundled at build time via Vite's import.meta.glob from
 * src/assets/facilities/thumbs/<village>/<facility>.webp, so dropping a new
 * <village>/<facility>.webp in place is all it takes — there is no import list to
 * keep in sync with the files on disk.
 *
 * CLIENT-ONLY: this module uses import.meta.glob (a Vite feature) and is therefore
 * NOT node-testable — keep it out of the test runner.
 */
import type { FacilityId } from "./facility-presentation";

// eager: resolve URLs at build time; import the default (the asset URL string).
const modules = import.meta.glob("../assets/facilities/thumbs/*/*.webp", {
    eager: true,
    import: "default",
}) as Record<string, string>;

export type VillageThumbKey = "frostfang" | "stormveil" | "ashen-leaf" | "moonshadow";

// Painted village name → thumbnail folder key. An unknown/renamed village falls
// back to the Frostfang set so the map still renders a full set of icons.
const VILLAGE_TO_KEY: Record<string, VillageThumbKey> = {
    "Frostfang Village": "frostfang",
    "Stormveil Village": "stormveil",
    "Ashen Leaf Village": "ashen-leaf",
    "Moonshadow Village": "moonshadow",
};
const FALLBACK_VILLAGE: VillageThumbKey = "frostfang";

// village folder → (facility id → bundled URL), parsed from the glob paths so we
// are robust to how Vite formats the module keys (mirrors lib/jutsu-fx-assets.ts).
const byVillage: Record<string, Record<string, string>> = (() => {
    const out: Record<string, Record<string, string>> = {};
    for (const [path, url] of Object.entries(modules)) {
        const m = /\/thumbs\/([^/]+)\/([^/]+)\.webp$/.exec(path);
        if (!m) continue;
        (out[m[1]] ||= {})[m[2]] = url;
    }
    return out;
})();

/**
 * The painted emblem icon for a facility, themed to the given painted village.
 * Falls back to the Frostfang set for an unknown village or any (unexpected)
 * missing tile, so the village map never renders a broken image.
 */
export function facilityThumb(village: string, facilityId: FacilityId): string {
    const key = VILLAGE_TO_KEY[village] ?? FALLBACK_VILLAGE;
    return byVillage[key]?.[facilityId] ?? byVillage[FALLBACK_VILLAGE]?.[facilityId] ?? "";
}
