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
    | "self_has_debuff"
    | "self_resource_lower_than"
    | "player_resource_lower_than"
    | "self_status_present"
    | "self_status_absent"
    | "player_status_present"
    | "player_status_absent"
    | "cooldown_ready"
    | "cooldown_active"
    | "player_recent_action"
    | "ally_count_lower_than"
    | "objective_state"
    | "threat_higher_than";
// Actions a matched rule can take. The reactive set (clear_player_buffs /
// cleanse_self / defend) is gated by band competence (pveAiCompetence) so only
// medium+ enemies actually counter-play; lower bands ignore them.
export type AiAction =
    | "use_specific_jutsu"
    | "use_highest_power_jutsu"
    | "use_best_legal_jutsu"
    | "move_towards_opponent"
    | "use_movement_jutsu"
    | "use_basic_attack"
    | "heal"
    | "buff"
    | "clear_player_buffs"
    | "cleanse_self"
    | "defend"
    | "summon_add"
    | "hold_objective"
    | "end_turn";
export type AiTarget =
    | "self" | "opponent" | "nearest" | "farthest" | "lowest_hp"
    | "highest_threat" | "support_role" | "most_buffed" | "most_debuffed"
    | "isolated" | "empty_ground_near_target" | "safe_ground" | "objective_tile";
export type AiResource = "chakra" | "stamina" | "ap";
export type AiRecentAction = "any_jutsu" | "basic_attack" | "move" | "heal" | "item" | "defend" | "summon" | "flee" | "wait";
export type AiLoadoutId = "balanced" | "control" | "burst" | "bruiser" | "defender" | "hunter" | "boss";

export type AiRule = {
    id: string;
    condition: AiCondition;
    value: number;
    action: AiAction;
    jutsuId?: string;
    target?: AiTarget;
    resource?: AiResource;
    status?: string;
    pattern?: AiRecentAction;
    state?: string;
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
    // When true, the level-curve HP floor (aiHpForLevel) is NOT applied to this
    // AI's authored hp — the explicit hp is used verbatim. Lets a hand-tuned boss
    // (e.g. the Kage finale) sit BELOW the level-100 minimum the curve would
    // otherwise force. Without it, makeBuiltinAi / normalizeAiProfile silently
    // raise any sub-curve hp back up to aiHpForLevel(level).
    hpFloorExempt?: boolean;
};
