/*
 * Step 3c of the AI-fight migration: derive the encounter's SCALING from server
 * state, never from the request body.
 *
 * Until now `buildAiFightEncounter` was called with no `scaling`, so the server
 * opponent was built at its AUTHORED level while the client may have rebuilt it
 * at a different one. `body.opponentLevel` exists on the request but is
 * deliberately NOT read for the encounter — a client-chosen level is a
 * client-chosen difficulty, which is the authority this migration exists to
 * remove.
 *
 * WHAT ACTUALLY NEEDS SCALING — SMALLER THAN IT LOOKS
 * `relevelBuiltinAi` has exactly ONE call site in the whole client
 * (Arena.tsx, the `pendingAiProfile` memo), and it is gated on
 * `missionBattleActive && combatMissionByAiId(...)`. So COMBAT MISSIONS are the
 * only entry point that re-levels its opponent. Hunts, apex, rifts, endless,
 * raid and defense fights all use the profile at its authored level — which is
 * exactly what the server already produces when `scaling` is omitted.
 *
 * That is why this module resolves missions and returns undefined for
 * everything else: "undefined" is not a gap here, it is the correct, verified
 * answer, and it keeps the server byte-identical to the client for those modes.
 * If a future entry point starts re-levelling, add it here AND to the parity
 * test — do not infer a curve.
 *
 * MISSION_AI_* below mirror shinobij.client/src/data/combat-missions.ts.
 * `scripts/ai-fight-scaling-parity.test.ts` fails if they drift.
 */
import { MAX_LEVEL } from '../_xp-engine.js';
import { COMBAT_MISSIONS, type CombatMissionDef } from './_mission-catalog.js';
import type { AiFightScaling } from './_ai-fight-encounter.js';

/** Rank letter for a combat mission. The server catalog keys encode it
 *  (`combat-e-drill` → E); the client carries an explicit `rank` field, and the
 *  parity test asserts the two agree for every mission. */
export function combatMissionRank(def: Pick<CombatMissionDef, 'key'>): string {
    const match = /^combat-([a-z])-/.exec(String(def.key ?? ''));
    return match ? match[1].toUpperCase() : '';
}

// E-Rank is the onboarding "guaranteed win": no stat bonus at all.
const MISSION_AI_RANK_STAT_BONUS: Record<string, number> = {
    E: 0, D: 20, C: 35, B: 55, A: 75, S: 90,
};
// Minimum HP a combat-mission foe has, so early foes are not one-tapped.
const MISSION_AI_HP_FLOOR = 1400;
// The E-Rank Drill foe gets a much lower floor so it dies fast.
const MISSION_AI_RANK_HP_FLOOR: Record<string, number> = { E: 600 };

/** Target level, stat bonus and HP floor for a combat mission's AI given the
 *  player's level. Mirrors the client's `missionAiLevelAndBonus`. */
export function missionAiLevelAndBonus(
    mission: Pick<CombatMissionDef, 'key' | 'min'>,
    playerLevel: number,
): { level: number; statBonus: number; hp: number } {
    const lvl = Math.max(1, Math.floor(Number.isFinite(playerLevel) ? playerLevel : 1));
    const level = Math.max(mission.min, Math.min(MAX_LEVEL, lvl));
    const rank = combatMissionRank(mission);
    return {
        level,
        statBonus: MISSION_AI_RANK_STAT_BONUS[rank] ?? 0,
        hp: MISSION_AI_RANK_HP_FLOOR[rank] ?? MISSION_AI_HP_FLOOR,
    };
}

/** The combat mission an AI profile belongs to, if any. Server catalog only. */
export function combatMissionByAiId(aiProfileId: unknown): CombatMissionDef | undefined {
    const id = typeof aiProfileId === 'string' ? aiProfileId : '';
    if (!id) return undefined;
    return COMBAT_MISSIONS.find(mission => mission.aiProfileId === id);
}

/**
 * Scaling for one AI fight, from server state.
 *
 * `battleKind` narrows WHICH fight this is — the client gates its own re-level
 * on the same signal (`missionBattleActive`). It is safe to take from the body:
 * it selects a curve, never a reward, and the mission it selects must still
 * exist in the SERVER catalog and match the opponent. Claiming 'mission' also
 * scales the foe toward the player's own level, so it makes the fight harder,
 * not easier.
 *
 * Returns undefined for every other kind → the opponent is built at its
 * authored level, which is what the client does for those fights too.
 */
export function resolveAiFightScaling(params: {
    opponentId: unknown;
    battleKind: unknown;
    playerLevel: unknown;
}): AiFightScaling | undefined {
    if (params.battleKind !== 'mission') return undefined;
    const mission = combatMissionByAiId(params.opponentId);
    if (!mission) return undefined;
    const level = Math.max(1, Math.floor(Number(params.playerLevel) || 1));
    const { level: target, statBonus, hp } = missionAiLevelAndBonus(mission, level);
    return { level: target, statBonus, hpFloor: hp };
}
