/*
 * Step C of the AI-fight migration: give server AI enemies their jutsu mastery.
 *
 * THE BUG THIS CLOSES
 * `api/pvp/move.ts` applyJutsu reads jutsu mastery off the CASTER's
 * `character.jutsuMastery`. No server enemy TEMPLATE has ever carried one, so
 * every server-sealed AI has been casting at `masteryDamageFrac(0) = 0.3` —
 * THIRTY PERCENT of the jutsu damage the client's PvE AI deals, which passes
 * `pveAiMasteryForLevel(level)` explicitly. Empirically ~3.3x in
 * api/towers/_pve-guard.test.ts.
 *
 * That it is an oversight rather than a balance choice is settled by
 * `api/towers/_merc-fighters.ts`: squad-side AI ALLIES are built with
 * `jutsuMastery: level 50` on every jutsu. Allies have been fighting at full
 * power and enemies at 30% in the same encounter.
 *
 * SHIPPED ON. `DISABLE_PVE_AI_MASTERY=1` is a rollback switch, plus a per-mode
 * `DISABLE_PVE_AI_MASTERY_<MODE>` — this is a large damage change, so each mode
 * can be dialled back on its own without losing the rest.
 *
 * ORDER MATTERS — MASTERY MUST FOLLOW THE GUARD (owner ruling). Every mode armed
 * here got the standard-PvE hit guard in step B (api/_pve-band-seal.ts), so the
 * uplift lands against a per-hit / per-turn ceiling. Enabling mastery on a mode
 * with no ceiling would wreck onboarding, which is exactly why the two modes
 * below are excluded.
 */
import { pveAiMasteryForLevel } from './_pve-difficulty.js';
import { jutsuLevelCapForLevel } from './combat-core/formulas.js';
import type { TowerSession, TowerActor } from './towers/_tower-session.js';

export type PveAiMasteryDifficulty = 'weaker' | 'standard' | 'dangerous' | 'elite' | 'final-kage';

/** Ordinary opponents follow the same progression available to players:
 * ryo lessons stop at 30, Seal lessons at 40, and battle mastery at 50.
 * Character-rank caps apply first. Unclassified legacy hosts keep their sealed
 * historical curve; this does not rewrite player copies or active sessions. */
export function pveAiMasteryForEncounter(level: number, difficulty: unknown): number {
    const standard = Math.min(30, pveAiMasteryForLevel(level));
    const rankCap = jutsuLevelCapForLevel(level);
    switch (difficulty) {
        case 'weaker': return Math.floor(standard * 0.7);
        // Veteran roads contain trained opponents, not permanent ryo-only
        // pupils. Seal training is available to players at these levels too.
        // Weaker rolls and the protected lower-level curve keep their old cap.
        case 'standard': return level >= 86 ? rankCap : level >= 61 ? Math.min(40, rankCap) : standard;
        case 'dangerous': return Math.min(level >= 86 ? 50 : 40, rankCap);
        case 'elite':
        case 'final-kage': return rankCap;
        default: return pveAiMasteryForLevel(level);
    }
}

export type PveMasteryMode =
    | 'MISSION'    // api/missions/combat-start.ts
    | 'STORY'      // api/story/boss-start.ts
    | 'TOWER'      // api/towers/start.ts (story floors)
    | 'SPIRE'      // api/towers/start.ts (Endless Spire — its own switch, see below)
    | 'CLAN_BOSS'; // api/clan-boss/assault-start.ts

/*
 * NOT ARMED HERE, deliberately:
 *
 * • WEEKLY BOSS. It now runs on the independent Solo PvE engine, which seals
 *   its own 8%/hit, 15%/turn guard and mastery. Tower-mode mastery must not
 *   mutate that separate runtime.
 * • ANBU VAULT. It now runs on the independent Solo PvE engine against a
 *   canonically hydrated snapshot of a REAL player, including that player's own
 *   jutsuMastery. Tower-mode mastery must not mutate the separate runtime.
 * • AI FIGHTS. `buildSoloPveAiEncounter` seals mastery in its own runtime.
 * • HOLLOW GATE. It now runs on the independent Solo PvE engine.
 *
 * ⚠ SPIRE gets its own switch because the Endless Spire's bosses are level 100,
 * which is the PEER band — where the hit guard is an intentional no-op ("endgame
 * PvE still hits like a real duel"). So the Spire is the one armed mode where
 * this uplift is UNBOUNDED. That is arguably where it belongs most (a peer-band
 * duellist casting at 30% is the bug at its starkest), but it is also the
 * largest single difficulty swing in this change — hence a dedicated dial.
 */

export function pveAiMasteryEnabled(mode: PveMasteryMode, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.DISABLE_PVE_AI_MASTERY === '1') return false;
    return env[`DISABLE_PVE_AI_MASTERY_${mode}`] !== '1';
}

/**
 * Seal `jutsuMastery` onto every AI enemy that lacks one, in place. Tower/Spire
 * delayed waves and future phase-summon templates use the same launch-time policy.
 *
 * NEVER OVERWRITES an existing array. That is what keeps this safe for actors
 * sealed from a real save (`sealTowerFighter` carries the player's own mastery)
 * and for encounters that already sealed their own, and it makes the call
 * idempotent — a re-seal cannot ratchet a boss upward.
 *
 * Scoped to `side === 'enemy'`: squad members carry their real mastery and NPC
 * allies (merc fighters) are already built with 50.
 *
 * Returns the number of actors sealed (including queued waves); future template
 * copies are not actors yet and are excluded from this count.
 */
export function sealPveAiMastery(
    session: TowerSession,
    opts: { mode: PveMasteryMode; env?: NodeJS.ProcessEnv },
): number {
    if (!pveAiMasteryEnabled(opts.mode, opts.env ?? process.env)) return 0;

    const towerReinforcements = opts.mode === 'TOWER' || opts.mode === 'SPIRE';
    const actors = towerReinforcements
        ? [...session.actors, ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)]
        : session.actors;
    let sealed = 0;
    for (const actor of actors) {
        if (actor.side !== 'enemy') continue;
        if (applyAiMasteryToActor(actor)) sealed++;
        // Phase adds do not exist yet. Seal their own level/kit in a private
        // template copy so they keep the launch-time policy and rollback choice.
        const template = actor.character.summonTemplate;
        if (towerReinforcements && template && typeof template === 'object' && !Array.isArray(template)) {
            const character = structuredClone(template) as Record<string, unknown>;
            if (applyAiMasteryToCharacter(character)) actor.character.summonTemplate = character;
        }
    }
    return sealed;
}

/** Seal one actor; returns false when it was skipped. Exported for the AI-fight
 *  path, which seals a single boss and wants the identical arithmetic. */
export function applyAiMasteryToActor(actor: TowerActor): boolean {
    return applyAiMasteryToCharacter(actor.character);
}

function applyAiMasteryToCharacter(character: Record<string, unknown>): boolean {
    const jutsu = character.jutsu;
    if (!Array.isArray(jutsu) || jutsu.length === 0) return false;
    if (Array.isArray(character.jutsuMastery)) return false; // already sealed — never overwrite

    const level = pveAiMasteryForLevel(Number(character.level) || 1);
    const mastery = (jutsu as Array<{ id?: unknown }>)
        .map(entry => ({ jutsuId: String(entry?.id ?? ''), level }))
        .filter(entry => entry.jutsuId);
    if (mastery.length === 0) return false;
    character.jutsuMastery = mastery;
    return true;
}
