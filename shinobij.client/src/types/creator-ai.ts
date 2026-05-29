/*
 * Creator AI definition types — the admin/creator-authored NPC opponent shape
 * plus the rule-engine vocabulary (conditions, actions, loadout presets).
 *
 * Extracted from App.tsx so combat AI logic (lib/ai-profiles, the battle
 * screens) can reference them without importing the App module surface.
 */

import type { Stats } from "./combat";

export type AiCondition = "always" | "specific_round" | "distance_lower_than" | "distance_higher_than" | "hp_lower_than";
export type AiAction = "use_specific_jutsu" | "use_highest_power_jutsu" | "move_towards_opponent" | "use_basic_attack";
export type AiLoadoutId = "balanced" | "control" | "burst" | "bruiser" | "defender" | "hunter" | "boss";

export type AiRule = {
    id: string;
    condition: AiCondition;
    value: number;
    action: AiAction;
    jutsuId?: string;
};

export type CreatorAi = {
    id: string;
    name: string;
    icon: string;
    image?: string;
    level: number;
    village: string;
    hp: number;
    chakra: number;
    stamina: number;
    stats: Stats;
    armorRawDR?: number;
    armorFactor?: number;
    loadoutId?: AiLoadoutId;
    jutsuIds: string[];
    rules: AiRule[];
    isBossAi?: boolean;
    // When true, force the smart battle AI (lethal detection, DoT-aware
    // KO, no-redundant status, full jutsu pool, multi-axis scoring) even
    // if the AI is below the level-30 auto-threshold. Lets admins flag a
    // low-level "elite" mob as a real fight without bumping its level.
    masterAi?: boolean;
};
