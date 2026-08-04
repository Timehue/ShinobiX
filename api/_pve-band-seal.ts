/*
 * Step B of the AI-fight migration: arm the standard-PvE difficulty layer on the
 * OTHER server PvE modes (docs/handoffs/ai-fight-migration-handoff.md).
 *
 * Step 3b built the curve (api/_pve-difficulty.ts) and the engine half (the
 * per-hit / per-turn / mercy clamp in api/towers/_engine.ts, plus the band AI
 * behaviour from step A). Both were gated on a session having SEALED
 * `pveGuard`, and only `buildAiFightEncounter` did. This module is the single
 * place every other entry point calls to arm it.
 *
 * SHIPPED ON. `DISABLE_PVE_DIFFICULTY_GUARD=1` is a rollback switch, not a
 * launch gate — the default path is the armed one, per the owner ruling
 * ("extend the guard + band layer to every server PvE mode, default ON with a
 * kill switch"). Each mode also has its own `DISABLE_PVE_DIFFICULTY_GUARD_<MODE>`
 * so one mode can be dialled back without losing the rest.
 *
 * WHY THIS IS A REAL BALANCE CHANGE, NOT A PARITY FIX
 * These modes are resolved by the SERVER engine today (MissionArenaFight posts
 * to /api/towers/action), so the client's own `isStandardPve` band in Arena.tsx
 * never applied to them — their enemy templates were hand-tuned with no band and
 * no clamp. Arming it makes them EASIER until step C (enemy jutsu mastery, worth
 * ~3.3x enemy jutsu damage) lands. That order is deliberate: mastery first would
 * wreck onboarding, because these modes have no mercy caps today.
 */
import {
    pveDifficultyHpMultiplier,
    pveDifficultyStatMultiplier,
    scaleStatsForPveDifficulty,
} from './_pve-difficulty.js';
import type { TowerSession, TowerActor } from './towers/_tower-session.js';

/** Modes that arm the layer. The string is both the telemetry label and the
 *  suffix of the per-mode kill switch (`DISABLE_PVE_DIFFICULTY_GUARD_MISSION`). */
export type PveBandMode =
    | 'MISSION'      // api/missions/combat-start.ts   — guard + full band
    | 'STORY'        // api/story/boss-start.ts        — guard + full band
    | 'AI_FIGHT'     // api/missions/_ai-fight-encounter.ts (seals its own, step 3b)
    | 'TOWER'        // api/towers/start.ts            — guard only (towers + Spire)
    | 'CLAN_BOSS';   // api/clan-boss/assault-start.ts — guard only

/*
 * TWO SERVER PvE MODES ARE DELIBERATELY NOT ARMED HERE.
 *
 * • WEEKLY BOSS. Its dedicated Solo PvE score-attack guard lives in
 *   `api/solo-pve/_engine.ts`: 8% per hit / 15% per turn with no peer band or
 *   mercy floor, plus the player→boss open/guarded cycle. Applying this generic
 *   band as well would double-scale a deliberately bespoke encounter.
 *
 * • ANBU VAULT. Its opponent is `getOrSealAnbuSnapshot(...)`, a sealed snapshot
 *   of a REAL player's ANBU defender. That is precisely the `opponentCharacter`
 *   case the client's own `isStandardPve` carves out. Banding it would scale a
 *   real player's defensive loadout down by up to 40%, which is a PvP balance
 *   change wearing a PvE hat.
 */

export interface PveBandOptions {
    mode: PveBandMode;
    /**
     * Band input — the ENCOUNTER's level, not the player's. Omit to derive it
     * from the session's own enemies (the 'boss' actor, else the highest enemy
     * level), which is what every caller that has no separate level wants.
     */
    enemyLevel?: number;
    /** Scale enemy max HP by the band. Default true. */
    scaleHp?: boolean;
    /** Scale enemy stats by the band. Default true. */
    scaleStats?: boolean;
    /** Seal `pveGuard` so the engine runs the per-hit/per-turn/mercy clamp and
     *  the band AI behaviour. Default true. */
    sealGuard?: boolean;
    env?: NodeJS.ProcessEnv;
}

export function pveDifficultyGuardEnabled(mode: PveBandMode, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.DISABLE_PVE_DIFFICULTY_GUARD === '1') return false;
    return env[`DISABLE_PVE_DIFFICULTY_GUARD_${mode}`] !== '1';
}

const enemiesOf = (session: TowerSession): TowerActor[] => session.actors.filter(a => a.side === 'enemy');

/**
 * The level the band keys off: the encounter's BOSS when there is one, else the
 * highest enemy level on the board — so a boss+adds floor bands on the boss
 * rather than on its weakest mob. Deterministic; a settle recompute reproduces it.
 *
 * The boss is found via `phaseState.bossId` first, because the tower/spire/
 * clan-boss builders assign generated ids and only the solo encounter builders
 * literally name the actor 'boss'. Matching on the string alone would silently
 * fall through to the max-scan on every tower floor.
 */
export function pveBandLevelForSession(session: TowerSession): number {
    const enemies = enemiesOf(session);
    if (enemies.length === 0) return 1;
    const bossId = session.phaseState?.bossId;
    const boss = (bossId ? enemies.find(a => a.id === bossId) : undefined)
        ?? enemies.find(a => a.id === 'boss');
    const pick = boss ?? enemies.reduce((hi, a) =>
        (Number(a.character.level) || 1) > (Number(hi.character.level) || 1) ? a : hi, enemies[0]);
    return Math.max(1, Math.floor(Number(pick.character.level) || 1));
}

/**
 * Arm the standard-PvE difficulty layer on `session`, in place.
 *
 * IDEMPOTENT, on two levels. A session that already carries `pveGuard` is left
 * completely alone, and every enemy the band touches is stamped `pveBandScaled`
 * so it can never be scaled twice — the same failure `applyPartyScaling` guards
 * with its `towerDmgScale` mark. Both matter because these handlers can rebuild
 * or re-seal a session, and compounding (0.6 x 0.6) would turn a tuned fight
 * into a trivial one. The per-actor stamp is what protects the scale-only modes
 * (weekly boss), which leave no `pveGuard` behind to check.
 *
 * Returns true when it armed something, false when a kill switch or the
 * idempotency guard skipped it.
 */
export function sealPveDifficultyBand(session: TowerSession, opts: PveBandOptions): boolean {
    const env = opts.env ?? process.env;
    if (!pveDifficultyGuardEnabled(opts.mode, env)) return false;
    if (session.pveGuard) return false; // already armed — never compound

    const level = Math.max(1, Math.floor(
        Number.isFinite(opts.enemyLevel) ? Number(opts.enemyLevel) : pveBandLevelForSession(session),
    ));
    const scaleHp = opts.scaleHp !== false;
    const scaleStats = opts.scaleStats !== false;
    const sealGuard = opts.sealGuard !== false;
    if (!scaleHp && !scaleStats && !sealGuard) return false;

    const hpMult = pveDifficultyHpMultiplier(level);
    const statMult = pveDifficultyStatMultiplier(level);
    for (const enemy of enemiesOf(session)) {
        // Per-actor idempotency mark (see the doc comment). Checked even when
        // this call only seals the guard, so a later scale-only call cannot
        // compound on top of an already-banded enemy.
        if (enemy.character.pveBandScaled === true) continue;
        if (scaleHp || scaleStats) enemy.character.pveBandScaled = true;
        if (scaleHp && hpMult !== 1) {
            // Order matches the client (relevel applies the HP floor, THEN the
            // band multiplies) and current HP is clamped, never raised — a
            // mid-fight re-seal must not heal the enemy.
            enemy.maxHp = Math.max(1, Math.floor(enemy.maxHp * hpMult));
            enemy.hp = Math.min(enemy.hp, enemy.maxHp);
        }
        if (scaleStats && statMult !== 1) {
            const stats = enemy.character.stats as Record<string, number> | undefined;
            if (stats && typeof stats === 'object') {
                enemy.character.stats = scaleStatsForPveDifficulty(stats, statMult);
            }
        }
    }

    if (sealGuard) {
        session.pveGuard = { enemyLevel: level, turnStartHp: {}, dealtThisTurn: {} };
    }
    return true;
}
