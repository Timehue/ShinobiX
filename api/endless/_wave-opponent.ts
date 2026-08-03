import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { endlessScaleFactor } from './_run.js';

/*
 * Server-generated Endless Tower wave opponents — step 5 subsystem 2 of the
 * AI-fight migration (docs/runbooks/combat-mode-migration.md).
 *
 * WHY THIS EXISTS
 * Endless is the odd one of the six: its ECONOMY has been server-authoritative
 * for a long time (api/endless/_run.ts recomputes the entry cost, the per-wave
 * ryo, the milestone drops and the cash-out from the wave number alone). What is
 * still client-owned is the FIGHT — `action:'win'` is the client saying "I beat
 * wave N, here are my vitals" — and the opponent, which the client picks at
 * random from its own roster and scales into a runtime `endless-<base>-w<wave>`
 * id. No catalog can resolve that id, so the sealed path could never take an
 * endless wave. This module is what removes that blocker.
 *
 * DETERMINISTIC, NOT RANDOM
 * The client used `Math.random()`. The server cannot: the wave has to be
 * reproducible from state the server already holds, so a reconnect, a retry or
 * a settle re-derives the SAME opponent instead of rerolling one. The seed is
 * the run's own token plus the wave number, so it is stable within a wave,
 * different across waves, and unguessable-in-advance to a player who does not
 * know their runToken (which is server-minted).
 *
 * ⚠ THE POOL DIFFERS FROM THE CLIENT'S, ON PURPOSE. The client draws from
 * `playableAis` (its built-in roster PLUS admin-authored creatorAis); the server
 * draws from the generated catalog. Making the server match the client exactly
 * would mean trusting the client's roster, which is the authority this migration
 * removes. So the parity guarantee here is over the SCALING MATH — a given base
 * profile at a given wave must produce byte-identical stats on both sides — and
 * NOT over which opponent gets picked. `scripts/endless-wave-parity.test.ts`
 * pins exactly that, and no more.
 */

export type EndlessProfile = Record<string, unknown> & {
    id: string;
    name?: string;
    level?: number;
    hp?: number;
    chakra?: number;
    stamina?: number;
    stats?: Record<string, number>;
    isBossAi?: boolean;
};

/** FNV-1a over `${runToken}:${wave}`. Cheap, dependency-free and stable across
 *  processes — the same run always re-derives the same wave. */
export function endlessWaveSeed(runToken: unknown, wave: unknown): number {
    const key = `${typeof runToken === 'string' ? runToken : ''}:${Math.max(1, Math.floor(Number(wave) || 1))}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * The per-wave scaled clone. A verbatim port of the client's
 * `scaleEndlessAiClone` (shinobij.client/src/lib/endless-tower.ts) — same
 * factor, same caps (stats ×4, HP ×5, pools ×3 of a 0.8-scaled factor), same
 * `Math.floor` at every step, same id and display name.
 *
 * The floors matter: scaling then flooring is not the same as flooring then
 * scaling, and a one-HP difference between the two sides would be a different
 * fight. Do not "simplify" the arithmetic.
 */
export function scaleEndlessProfile(base: EndlessProfile, waveRaw: unknown): EndlessProfile {
    const wave = Math.max(1, Math.floor(Number(waveRaw) || 1));
    const factor = endlessScaleFactor(wave);
    const stats = (base.stats ?? {}) as Record<string, number>;
    const scaledStats: Record<string, number> = {};
    for (const key of Object.keys(stats)) {
        scaledStats[key] = Math.floor(Number(stats[key]) * Math.min(4, factor));
    }
    const name = typeof base.name === 'string' ? base.name : base.id;
    return {
        ...base,
        id: `endless-${base.id}-w${wave}`,
        name: wave % 10 === 0 ? `★ ${name} (Floor ${wave})` : `${name} (Floor ${wave})`,
        hp: Math.floor(Number(base.hp ?? 0) * Math.min(5, factor)),
        chakra: Math.floor(Number(base.chakra ?? 0) * Math.min(3, factor * 0.8)),
        stamina: Math.floor(Number(base.stamina ?? 0) * Math.min(3, factor * 0.8)),
        stats: scaledStats,
    };
}

/**
 * The catalog in a STABLE order. Object key order is insertion order, which is
 * an artifact of how the mirror happens to be generated; sorting by id means a
 * regeneration that merely reorders entries cannot silently reshuffle which
 * opponent every in-flight run is facing.
 */
function catalogInStableOrder(): EndlessProfile[] {
    return Object.keys(AI_PROFILE_CATALOG)
        .sort()
        .map((id) => AI_PROFILE_CATALOG[id] as unknown as EndlessProfile);
}

/**
 * The profiles a given wave is allowed to draw from. Mirrors the client's rule
 * argument-for-argument: difficulty tracks the player's level plus 5 per wave
 * (capped at 100), and Boss AIs only surface on milestone floors (every 10th).
 *
 * The empty-pool fallback is the client's too: if nothing sits under the cap,
 * fall back to the whole non-boss candidate list rather than returning nothing,
 * so an under-levelled player still gets a fight.
 */
export function eligibleEndlessProfiles(waveRaw: unknown, playerLevelRaw: unknown): EndlessProfile[] {
    const wave = Math.max(1, Math.floor(Number(waveRaw) || 1));
    const playerLevel = Math.max(1, Math.floor(Number(playerLevelRaw) || 1));
    const all = catalogInStableOrder();
    const cap = Math.min(100, playerLevel + wave * 5);
    const allowBoss = wave % 10 === 0;
    const candidates = all.filter((ai) => allowBoss || !ai.isBossAi);
    const pool = candidates.filter((ai) => Math.max(1, Math.floor(Number(ai.level) || 1)) <= cap);
    if (pool.length > 0) return pool;
    return candidates.length > 0 ? candidates : all;
}

/**
 * The wave's opponent, generated end to end from server-held state: the run's
 * token, the wave number and the save's level. Nothing here reads the request.
 *
 * Returns null only if the catalog itself is empty, which would be a build
 * problem rather than a runtime one — callers should treat it as "cannot seal"
 * and let the fight fall back, never fabricate a stand-in.
 */
export function pickEndlessWaveOpponent(params: {
    runToken: string;
    wave: number;
    playerLevel: number;
}): EndlessProfile | null {
    const pool = eligibleEndlessProfiles(params.wave, params.playerLevel);
    if (pool.length === 0) return null;
    const seed = endlessWaveSeed(params.runToken, params.wave);
    return scaleEndlessProfile(pool[seed % pool.length], params.wave);
}
