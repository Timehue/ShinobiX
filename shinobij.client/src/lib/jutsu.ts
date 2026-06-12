/*
 * Jutsu builder + normalizer — the canonical shape-fixer that fills defaults,
 * normalizes tags/method/target and floors range, plus the makeJutsu convenience
 * constructor used by the starter catalog and the bloodline editor.
 *
 * Pure functions depending only on lib/tags and the type modules.
 * Extracted from App.tsx (jutsu cluster).
 */

import { normalizeJutsuTags, tagMatchesName, normalizeJutsuMethod, hasFixedEffectPower } from "./tags";
import { makeId } from "./utils";
import type { Jutsu, JutsuTag } from "../types/combat";
import type { JutsuType, JutsuElement, JutsuTarget, Rank } from "../types/core";

export function normalizeJutsu(jutsu: Partial<Jutsu> & Pick<Jutsu, "id" | "name" | "type">): Jutsu {
    const tags = normalizeJutsuTags(jutsu.tags);
    const hasMoveTag = tags.some((tag) => tagMatchesName(tag.name, "Move"));
    // Strip the legacy EP-100 "fixed effect" sentinel: a jutsu carrying a binary
    // control / displacement tag deals STANDARD 60-AP damage (40), not
    // effectPower-100 (~3200). Clamp here at the load boundary so the sentinel
    // never reaches the damage formula / preview. Mirrors api/pvp/_tags.ts.
    // (40-AP fixed-effect jutsu stay zero-damage via the utility rule regardless.)
    const rawEffectPower = jutsu.effectPower ?? 50;
    const effectPower = hasFixedEffectPower({ tags }) ? Math.min(rawEffectPower, 40) : rawEffectPower;
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
        effectPower,
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
        // Carry the recency stamp through normalization (this function rebuilds a
        // fixed-shape object, so an un-listed field would be silently dropped and
        // the shared-merge tie-break would lose its signal on every reload).
        ...(jutsu.updatedAt != null ? { updatedAt: jutsu.updatedAt } : {}),
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

export function isSelfSupportJutsu(jutsu: Jutsu) {
    return jutsu.target === "SELF" || jutsu.tags.some((tag) => ["Heal", "Shield", "Barrier", "Reflect", "Absorb", "Decrease Damage Taken", "Debuff Prevent", "Stun Prevent"].includes(tag.name));
}

export function isControlJutsu(jutsu: Jutsu) {
    return jutsu.target !== "SELF" && jutsu.tags.some((tag) => ["Stun", "Bloodline Seal", "Seal", "Elemental Seal", "Decrease Damage Given", "Increase Damage Taken", "Buff Prevent", "Cleanse Prevent", "Clear Prevent", "Lag"].some((name) => tagMatchesName(tag.name, name)));
}

export function isPressureJutsu(jutsu: Jutsu) {
    return jutsu.target !== "SELF" && jutsu.tags.some((tag) => ["Ignition", "Wound", "Poison", "Drain", "Siphon"].some((name) => tagMatchesName(tag.name, name)));
}
