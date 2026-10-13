/*
 * Jutsu dropdown filter + sort. Extracted verbatim from App.tsx (where it was
 * defined-only, used by JutsuDropdownList) to keep the monolith shrinking.
 */
import type { Jutsu } from "../types/combat";
import type { JutsuType, JutsuElement, JutsuSort } from "../types/core";
import { describeJutsuEffects } from "./jutsu-effects";

export function getJutsuSelectOptions(
    jutsus: Jutsu[],
    typeFilter: "All" | JutsuType,
    elementFilter: "All" | JutsuElement,
    sortBy: JutsuSort,
) {
    const filtered = [...jutsus]
        .filter((jutsu) => typeFilter === "All" || jutsu.type === typeFilter)
        .filter((jutsu) => elementFilter === "All" || jutsu.element === elementFilter);
    // The effect sort describes each jutsu once up front instead of twice per
    // comparison. Keyed by object (not id) so the ordering is exactly the same
    // even if two catalog entries ever shared an id.
    const effectText = sortBy === "effect"
        ? new Map(filtered.map((jutsu) => [jutsu, describeJutsuEffects(jutsu)] as const))
        : null;
    return filtered.sort((a, b) => {
        if (sortBy === "ap" || sortBy === "range" || sortBy === "effectPower") return a[sortBy] - b[sortBy];
        if (sortBy === "effect") {
            // The fallback never runs (every sorted jutsu is in the map); it only
            // keeps the lookup total for the type checker.
            const textA = effectText?.get(a) ?? describeJutsuEffects(a);
            const textB = effectText?.get(b) ?? describeJutsuEffects(b);
            return textA.localeCompare(textB) || a.name.localeCompare(b.name);
        }
        return String(a[sortBy]).localeCompare(String(b[sortBy])) || a.name.localeCompare(b.name);
    });
}
