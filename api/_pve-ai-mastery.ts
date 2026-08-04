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
import type { TowerSession, TowerActor } from './towers/_tower-session.js';

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
 * • AI FIGHTS. `buildAiFightEncounter` already seals its own mastery (step 3b).
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
 * Seal `jutsuMastery` onto every AI enemy that lacks one, in place.
 *
 * NEVER OVERWRITES an existing array. That is what keeps this safe for actors
 * sealed from a real save (`sealTowerFighter` carries the player's own mastery)
 * and for encounters that already sealed their own, and it makes the call
 * idempotent — a re-seal cannot ratchet a boss upward.
 *
 * Scoped to `side === 'enemy'`: squad members carry their real mastery and NPC
 * allies (merc fighters) are already built with 50.
 *
 * Returns the number of actors sealed, so callers/tests can assert it did work.
 */
export function sealPveAiMastery(
    session: TowerSession,
    opts: { mode: PveMasteryMode; env?: NodeJS.ProcessEnv },
): number {
    if (!pveAiMasteryEnabled(opts.mode, opts.env ?? process.env)) return 0;

    let sealed = 0;
    for (const actor of session.actors) {
        if (actor.side !== 'enemy') continue;
        if (!applyAiMasteryToActor(actor)) continue;
        sealed++;
    }
    return sealed;
}

/** Seal one actor; returns false when it was skipped. Exported for the AI-fight
 *  path, which seals a single boss and wants the identical arithmetic. */
export function applyAiMasteryToActor(actor: TowerActor): boolean {
    const jutsu = actor.character.jutsu;
    if (!Array.isArray(jutsu) || jutsu.length === 0) return false;
    if (Array.isArray(actor.character.jutsuMastery)) return false; // already sealed — never overwrite

    const level = pveAiMasteryForLevel(Number(actor.character.level) || 1);
    const mastery = (jutsu as Array<{ id?: unknown }>)
        .map(entry => ({ jutsuId: String(entry?.id ?? ''), level }))
        .filter(entry => entry.jutsuId);
    if (mastery.length === 0) return false;
    actor.character.jutsuMastery = mastery;
    return true;
}
