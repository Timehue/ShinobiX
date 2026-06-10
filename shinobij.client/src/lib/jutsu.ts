/*
 * Jutsu builder + normalizer — the canonical shape-fixer that fills defaults,
 * normalizes tags/method/target and floors range, plus the makeJutsu convenience
 * constructor used by the starter catalog and the bloodline editor.
 *
 * Pure functions depending only on lib/tags and the type modules.
 * Extracted from App.tsx (jutsu cluster).
 */

import { normalizeJutsuTags, tagMatchesName, normalizeJutsuMethod } from "./tags";
import { makeId } from "./utils";
import type { Jutsu, JutsuTag } from "../types/combat";
import type { JutsuType, JutsuElement, JutsuTarget, Rank } from "../types/core";

export function normalizeJutsu(jutsu: Partial<Jutsu> & Pick<Jutsu, "id" | "name" | "type">): Jutsu {
    const tags = normalizeJutsuTags(jutsu.tags);
    const hasMoveTag = tags.some((tag) => tagMatchesName(tag.name, "Move"));
    return {
        id: jutsu.id,
        name: jutsu.name,
        type: jutsu.type,
        element: (jutsu.element != null ? jutsu.element : "Fire") as JutsuElement,
        ap: jutsu.ap ?? 40,
        // Floor range to 1 — `??` doesn't catch 0/NaN/"" which any of the
        // save/import/form paths can produce, and range:0 silently turns
        // off the on-board range highlight (jutsuRangeTiles bails on <=0).
        range: Math.max(1, Number(jutsu.range) || 3),
        effectPower: jutsu.effectPower ?? 50,
        cooldown: jutsu.cooldown ?? 1,
        currentCooldown: jutsu.currentCooldown ?? 0,
        chakraCost: jutsu.chakraCost ?? 20,
        staminaCost: jutsu.staminaCost ?? 10,
        healthCost: jutsu.healthCost ?? 0,
        target: (hasMoveTag ? "EMPTY_GROUND" : (jutsu.target ?? "OPPONENT")) as JutsuTarget,
        method: normalizeJutsuMethod(jutsu.method),
        battleDescription: jutsu.battleDescription ?? `${jutsu.name} strikes %target`,
        healthCostReducePerLvl: jutsu.healthCostReducePerLvl ?? 0,
        chakraCostReducePerLvl: jutsu.chakraCostReducePerLvl ?? 0,
        staminaCostReducePerLvl: jutsu.staminaCostReducePerLvl ?? 0,
        tags,
        description: jutsu.description ?? "",
        image: jutsu.image ?? "",
    };
}

export function makeJutsu(id: string, name: string, type: JutsuType, ap: number, range: number, effectPower: number, cooldown: number, chakraCost: number, staminaCost: number, tags: JutsuTag[], element: JutsuElement = "Fire"): Jutsu {
    return normalizeJutsu({ id, name, type, element, ap, range, effectPower, cooldown, currentCooldown: 0, chakraCost, staminaCost, tags });
}

export function blankJutsu(index: number, rank: Rank): Jutsu {
    // v4.3: Wound rank caps — S Rank tops at 35%, A/B at 30%.
    const defaultPercent = rank === "S Rank" ? 35 : 30;
    return makeJutsu(makeId(), `Jutsu ${index + 1}`, "Ninjutsu", 60, 4, 40, 7, 300, 300, [
        { name: "", percent: defaultPercent },
        { name: "", percent: defaultPercent },
    ]);
}
