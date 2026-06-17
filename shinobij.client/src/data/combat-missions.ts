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
// to the PLAYER's level (floored at the rank's min) with a small, rank-scaled
// stat bonus — so a D-Rank Errand is a near-peer fight, not a fixed level-8 +30
// enemy versus a level-3 player. The bonuses are gentler than the catalog
// builtins' baked values (D used +30); the difficulty BANDS in lib/pve-difficulty
// supply the easy/medium/hard scaling on top, so this stays "near player level".
const MISSION_AI_RANK_STAT_BONUS: Record<string, number> = {
    D: 0, C: 6, B: 12, A: 18, S: 24,
};

/** Target level + stat bonus for a combat mission's AI given the player's level. */
export function missionAiLevelAndBonus(mission: CombatMission, playerLevel: number): { level: number; statBonus: number } {
    const lvl = Math.max(1, Math.floor(Number.isFinite(playerLevel) ? playerLevel : 1));
    const level = Math.max(mission.min, Math.min(MAX_LEVEL, lvl));
    return { level, statBonus: MISSION_AI_RANK_STAT_BONUS[mission.rank] ?? 0 };
}
