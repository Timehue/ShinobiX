/*
 * Creator AI definition types — the admin/creator-authored NPC opponent shape
 * plus the rule-engine vocabulary (conditions, actions, loadout presets).
 *
 * Extracted from App.tsx so combat AI logic (lib/ai-profiles, the battle
 * screens) can reference them without importing the App module surface.
 */

import type { Stats } from "./combat";

// Conditions the rule engine can test each enemy turn. The original set reads
// the clock / distance / the enemy's OWN hp; the player_* set (added with the
// smarter-PvE work) lets a rule react to what the PLAYER is doing. `value` keeps
// its numeric meaning per condition (see aiRuleMatches): player_hp_lower_than =
// HP%, player_has_buff = min active buff count, player_low_ap = AP threshold,
// self_has_debuff = min active debuff count; player_has_shield ignores value.
export type AiCondition =
    | "always"
    | "specific_round"
    | "distance_lower_than"
    | "distance_higher_than"
    | "hp_lower_than"
    | "player_hp_lower_than"
    | "player_has_shield"
    | "player_has_buff"
    | "player_low_ap"
    | "self_has_debuff";
// Actions a matched rule can take. The reactive set (clear_player_buffs /
// cleanse_self / defend) is gated by band competence (pveAiCompetence) so only
// medium+ enemies actually counter-play; lower bands ignore them.
export type AiAction =
    | "use_specific_jutsu"
    | "use_highest_power_jutsu"
    | "move_towards_opponent"
    | "use_basic_attack"
    | "clear_player_buffs"
    | "cleanse_self"
    | "defend";
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
