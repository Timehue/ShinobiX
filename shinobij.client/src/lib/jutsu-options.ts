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
    return [...jutsus]
        .filter((jutsu) => typeFilter === "All" || jutsu.type === typeFilter)
        .filter((jutsu) => elementFilter === "All" || jutsu.element === elementFilter)
        .sort((a, b) => {
            if (sortBy === "ap" || sortBy === "range" || sortBy === "effectPower") return a[sortBy] - b[sortBy];
            if (sortBy === "effect") return describeJutsuEffects(a).localeCompare(describeJutsuEffects(b)) || a.name.localeCompare(b.name);
            return String(a[sortBy]).localeCompare(String(b[sortBy])) || a.name.localeCompare(b.name);
        });
}
