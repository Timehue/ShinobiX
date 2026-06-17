/*
 * Combat missions — the D/C/B/A/S "Mission Hall → Combat" contracts.
 *
 * Single source of truth for the combat-mission rewards. Tune XP / ryo / level
 * requirements / territory-scroll payouts HERE — both the Mission Hall cards
 * (display) and the claim payout (Missions.claimCombatMission) read this table,
 * so the cards always show what the player actually receives.
 *
 * Flow: "Begin Mission" fights the mission's AI in the Arena. Winning only
 * QUEUES a claim on the character (Character.pendingCombatMissionClaims); the
 * reward is paid when the player returns to the Mission Hall and clicks
 * "Claim Reward". Stamina is intentionally NOT part of any combat-mission
 * reward — stamina only matters inside combat itself.
 */

import { MAX_LEVEL } from "../constants/game";

export type CombatMission = {
    /** Stable id persisted in Character.pendingCombatMissionClaims. Never reuse. */
    key: string;
    name: string;
    /** Single-letter rank — drives the card colour + label ("D" → "D Rank"). */
    rank: string;
    /** Minimum character level to begin. */
    min: number;
    /** XP reward, before Town Hall / Aura Sphere mission bonuses. */
    xp: number;
    /** Ryo reward, before Town Hall / Aura Sphere mission bonuses. */
    ryo: number;
    /** Territory Control Scrolls granted on claim. */
    territoryScrolls: number;
    /** Fallback glyph shown when the AI has no image. */
    icon: string;
    /** Builtin AI fought for this mission. */
    aiProfileId: string;
};

export const COMBAT_MISSIONS: CombatMission[] = [
    { key: "combat-d-errand", name: "D-Rank Errand", rank: "D", min: 1, xp: 25, ryo: 20, territoryScrolls: 1, icon: "D", aiProfileId: "builtin-ai-mist-sentinel" },
    { key: "combat-c-patrol", name: "C-Rank Patrol", rank: "C", min: 10, xp: 75, ryo: 60, territoryScrolls: 1, icon: "C", aiProfileId: "builtin-ai-ember-duelist" },
    { key: "combat-b-escort", name: "B-Rank Escort", rank: "B", min: 30, xp: 150, ryo: 125, territoryScrolls: 1, icon: "B", aiProfileId: "builtin-ai-frost-sealer" },
    { key: "combat-a-hunt", name: "A-Rank Hunt", rank: "A", min: 50, xp: 300, ryo: 250, territoryScrolls: 1, icon: "A", aiProfileId: "builtin-ai-shadow-weaver" },
    { key: "combat-s-crisis", name: "S-Rank Crisis", rank: "S", min: 70, xp: 700, ryo: 600, territoryScrolls: 1, icon: "S", aiProfileId: "builtin-ai-central-champion" },
];

/** Map a fought AI back to its combat mission (undefined if it isn't one). */
export function combatMissionByAiId(aiProfileId: string): CombatMission | undefined {
    return COMBAT_MISSIONS.find((mission) => mission.aiProfileId === aiProfileId);
}

/** Look up a queued claim's mission by its persisted key. */
export function combatMissionByKey(key: string): CombatMission | undefined {
    return COMBAT_MISSIONS.find((mission) => mission.key === key);
}

// Re-leveling for combat-mission AIs (see relevelBuiltinAi). The foe is aligned
// to the PLAYER's level (floored at the rank's min) with a rank-scaled stat
// bonus and an HP FLOOR, so a D-Rank Errand is a real fight at the player's
// level — not a fixed level-8 +30 enemy, but also not a paper foe that gets
// one-tapped. The HP floor matters because the shared damage curve is built for
// late-game HP pools: at low levels a single player hit (~900) dwarfs a low
// level's natural HP (~340), so without a floor the foe dies in one tap. The
// floor only binds at low levels (above ~lvl 13 the natural HP already exceeds
// it); higher ranks start high enough that it never binds. The difficulty BANDS
// in lib/pve-difficulty supply the easy/medium/hard scaling on top.
const MISSION_AI_RANK_STAT_BONUS: Record<string, number> = {
    D: 20, C: 35, B: 55, A: 75, S: 90,
};
// Minimum HP a combat-mission foe has, so early-game foes survive a couple of
// hits instead of being one-tapped by the flat ~900 low-level damage. Tunable.
const MISSION_AI_HP_FLOOR = 1400;

/** Target level, stat bonus and HP floor for a combat mission's AI given the player's level. */
export function missionAiLevelAndBonus(mission: CombatMission, playerLevel: number): { level: number; statBonus: number; hp: number } {
    const lvl = Math.max(1, Math.floor(Number.isFinite(playerLevel) ? playerLevel : 1));
    const level = Math.max(mission.min, Math.min(MAX_LEVEL, lvl));
    return { level, statBonus: MISSION_AI_RANK_STAT_BONUS[mission.rank] ?? 0, hp: MISSION_AI_HP_FLOOR };
}
