import type { Character } from "../types/character";
import type { JutsuType } from "../types/core";
import { adjustedCombatApCost, combatMethodLabel, combatTargetLabel, type CombatDisplayStatus } from "../lib/combat-action-display";
import { getJutsuMastery, jutsuResourceDisplay } from "../lib/jutsu-scaling";

type CombatJutsuDisplay = {
    id?: string;
    ap?: number;
    range?: number;
    cooldown?: number;
    type?: string;
    target?: string;
    method?: string;
    chakraCost?: number;
    staminaCost?: number;
};

export function CombatJutsuMeta({
    character,
    jutsu,
    statuses,
    round,
    activeCooldown = 0,
    sealedResourceCosts,
}: {
    character: Character;
    jutsu: CombatJutsuDisplay;
    statuses?: readonly CombatDisplayStatus[];
    round?: number;
    activeCooldown?: number;
    sealedResourceCosts?: { chakraCost: number; staminaCost: number };
}) {
    const mastery = getJutsuMastery(character, jutsu.id ?? "");
    const type: JutsuType = ["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu"].includes(jutsu.type ?? "")
        ? jutsu.type as JutsuType
        : "Any";
    const resourceJutsu = {
        ap: jutsu.ap ?? 0,
        type,
        chakraCost: jutsu.chakraCost ?? 0,
        staminaCost: jutsu.staminaCost ?? 0,
    };
    const chakra = sealedResourceCosts
        ? String(Math.max(0, Number(sealedResourceCosts.chakraCost) || 0))
        : jutsuResourceDisplay(resourceJutsu, "chakra", character.level, character.specialty, mastery.level);
    const stamina = sealedResourceCosts
        ? String(Math.max(0, Number(sealedResourceCosts.staminaCost) || 0))
        : jutsuResourceDisplay(resourceJutsu, "stamina", character.level, character.specialty, mastery.level);
    const resources = [chakra !== "0" && `${chakra} CP`, stamina !== "0" && `${stamina} SP`].filter(Boolean).join(" · ") || "No resource cost";
    const cooldown = activeCooldown > 0 ? `${activeCooldown} left` : String(jutsu.cooldown ?? 0);

    return (
        <>
            <span className="combat-jutsu-info">
                {adjustedCombatApCost(statuses, jutsu.ap ?? 0, round)} AP · R{jutsu.range ?? 0} · CD {cooldown}
            </span>
            <span className="combat-jutsu-method-target">
                {combatMethodLabel(jutsu.method)} · {combatTargetLabel(jutsu.target)}
            </span>
            <span className="combat-jutsu-resources">{resources}</span>
        </>
    );
}
