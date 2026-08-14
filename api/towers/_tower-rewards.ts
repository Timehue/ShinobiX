/*
 * Battle Towers — reward + Floor Clear Score computation (Phase 1, P1.B).
 *
 * PURE + server-authoritative: every payout is derived from the SEALED floor catalog
 * (or from server-computed clear metrics), NEVER from a client-supplied amount/outcome
 * (CLAUDE.md Security). settle.ts feeds these into the idempotent credit in
 * _tower-store.ts. See docs/battle-towers-plan.md §9, §26.
 */
import type { TowerFloor, TowerReward } from './_floor-catalog.js';
import type { TowerSession } from './_tower-session.js';

export type ClearMetrics = {
    roundsUsed: number;
    squadHpRemaining: number;
    squadHpMax: number;
    deaths: number;
};

// The reward a member earns for a first clear = the floor's SEALED catalog reward.
// Cloned so a caller can't mutate the catalog. Never read from the request body.
export function computeFloorReward(floor: TowerFloor): TowerReward {
    return { ...floor.firstClearReward };
}

// Capped assist reward for a borrowed/offline ally: a fraction of the clear's ryo/xp,
// no milestones/items. Bounded further by a daily cap in _tower-store.ts.
export const ASSIST_REWARD_FRACTION = 0.25;
export function computeAssistReward(floor: TowerFloor): TowerReward {
    const r = floor.firstClearReward;
    const frac = (n?: number) => (n != null ? Math.max(0, Math.floor(n * ASSIST_REWARD_FRACTION)) : undefined);
    return { ryo: frac(r.ryo), xp: frac(r.xp) };
}

// ── Floor Clear Score (plan §26) ─────────────────────────────────────────────
// v1 uses the engine-available metrics (speed + squad survival + no-death). The
// efficiency/damage terms (§26) are deferred until the engine tracks apSpent /
// damageDealt; the weights are rebalanced so perfMult stays in [1, 2]. The score is
// computed from the SERVER-recomputed sim result, never client-reported.
export const SCORE_WEIGHTS = { speed: 0.40, survival: 0.45, noDeath: 0.15 } as const;
export const FLOOR_BASE_SCORE = 100;
export const NO_DEATH_BONUS = 50;

export function computeFloorClearScore(m: ClearMetrics, floor: TowerFloor): number {
    const budget = Math.max(1, floor.roundBudget);
    // finishing earlier scores higher; at/over budget → 0 speed credit
    const speedTerm = Math.max(0, Math.min(1, (budget - m.roundsUsed + 1) / budget));
    const survivalTerm = m.squadHpMax > 0 ? Math.max(0, Math.min(1, m.squadHpRemaining / m.squadHpMax)) : 0;
    const noDeathTerm = m.deaths === 0 ? 1 : 0;
    const perfMult = 1
        + SCORE_WEIGHTS.speed * speedTerm
        + SCORE_WEIGHTS.survival * survivalTerm
        + SCORE_WEIGHTS.noDeath * noDeathTerm;
    const floorBase = FLOOR_BASE_SCORE * Math.max(1, floor.id); // deeper floors worth more
    return Math.round(floorBase * perfMult) + (m.deaths === 0 ? NO_DEATH_BONUS : 0);
}

// Derive the clear metrics from a resolved session (server-side; the source of truth
// for scoring). Deaths = squad actors at 0 HP (no revives in v1).
export function clearMetrics(session: TowerSession): ClearMetrics {
    const squad = session.actors.filter(a => a.side === 'squad');
    const squadHpRemaining = squad.reduce((s, a) => s + Math.max(0, a.hp), 0);
    const squadHpMax = squad.reduce((s, a) => s + Math.max(1, a.maxHp), 0);
    const deaths = squad.filter(a => a.hp <= 0).length;
    return { roundsUsed: session.round, squadHpRemaining, squadHpMax, deaths };
}
