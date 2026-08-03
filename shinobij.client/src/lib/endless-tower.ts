/*
 * Endless / Celestial Tower scaling + reward math.
 *
 *   • endlessScaleFactor          — per-wave difficulty/reward multiplier
 *   • endlessWaveReward           — ryo/xp banked per wave
 *   • endlessTowerMilestoneReward — currency drops on every 5th-kill milestone
 *   • scaleEndlessAiClone         — the per-wave scaled enemy clone
 *   • pickScaledEndlessAi         — choose + scale the next wave's opponent
 *
 * Pure numeric functions (plus applyTowerCashOut, type-only Character dep + an
 * injected gainXp). Extracted from App.tsx (Region A).
 */
import type { Character, EndlessTowerRun } from "../types/character";
import type { Stats } from "../types/combat";
import type { CreatorAi } from "../types/creator-ai";

// Endless Tower scaling — wave 1 is baseline; each wave adds a small multiplier,
// with milestone jumps every 5 and 10 waves.
export function endlessScaleFactor(wave: number): number {
    const w = Math.max(1, wave);
    const base = 1 + (w - 1) * 0.08;
    const fives = Math.floor(w / 5) * 0.10;
    const tens = Math.floor(w / 10) * 0.15;
    return Math.max(1, base + fives + tens);
}

/**
 * The per-wave scaled clone of a base AI. Offensive/defensive stats scale with
 * the wave factor capped at ×4; HP at ×5 and chakra/stamina at ×3 of baseline.
 * The clone's id (`endless-<base>-w<wave>`) is a RUNTIME id — it is deliberately
 * absent from the server's AI profile catalog, so an endless wave never seals a
 * server encounter and always plays on the local Arena engine.
 */
export function scaleEndlessAiClone(baseAi: CreatorAi, wave: number): CreatorAi {
    const factor = endlessScaleFactor(wave);
    // Clone stats and multiply offensive/defensive stats; cap HP/chakra/stamina at ×4 baseline.
    const scaledStats: Stats = { ...baseAi.stats };
    (Object.keys(scaledStats) as (keyof Stats)[]).forEach((k) => {
        scaledStats[k] = Math.floor(scaledStats[k] * Math.min(4, factor));
    });
    return {
        ...baseAi,
        id: `endless-${baseAi.id}-w${wave}`,
        name: wave % 10 === 0 ? `★ ${baseAi.name} (Floor ${wave})` : `${baseAi.name} (Floor ${wave})`,
        hp: Math.floor(baseAi.hp * Math.min(5, factor)),
        chakra: Math.floor(baseAi.chakra * Math.min(3, factor * 0.8)),
        stamina: Math.floor(baseAi.stamina * Math.min(3, factor * 0.8)),
        stats: scaledStats,
    };
}

/**
 * Pick the next wave's opponent and return its scaled clone (null when there is
 * no AI to pick at all). Difficulty scales to the player's level + 5 per wave,
 * capped at 100; Boss AIs only surface on milestone floors (every 10).
 */
export function pickScaledEndlessAi(playableAis: CreatorAi[], playerLevel: number, wave: number): CreatorAi | null {
    if (playableAis.length === 0) return null;
    const cap = Math.min(100, playerLevel + wave * 5);
    const allowBoss = wave % 10 === 0;
    const candidates = playableAis.filter(ai => allowBoss || !ai.isBossAi);
    const pool = candidates.filter(ai => (ai.level ?? 1) <= cap);
    const fallback = candidates.length > 0 ? candidates : playableAis;
    const chosen = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : fallback[Math.floor(Math.random() * fallback.length)];
    return scaleEndlessAiClone(chosen, wave);
}

export function endlessWaveReward(wave: number, playerLevel: number): { ryo: number; xp: number; isMilestone: boolean } {
    const factor = endlessScaleFactor(wave);
    const baseRyo = 40 + playerLevel * 6;
    const isMilestone = wave % 5 === 0;
    const milestoneBonus = isMilestone ? (wave % 10 === 0 ? 3 : 2) : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (15 + level·2) folds into banked ryo at ~0.75:1 — mirrors api/endless/_run.ts.
    // `xp` stays in the shape as 0 for older saves' run objects.
    return {
        ryo: Math.floor(baseRyo * factor * milestoneBonus) + Math.floor((15 + playerLevel * 2) * factor * milestoneBonus * 0.75),
        xp: 0,
        isMilestone,
    };
}

// Cash out a finished tower run onto the character. XP is retired, and with it
// the whole daily-XP-softcap subsystem: waves bank ryo only. A legacy in-flight
// run (started before the cutover) may still carry bankedXp — convert it at the
// same ~0.75:1 fold as the wave rewards so nobody's active run is voided.
// `gainXp` (now the derived-level recompute shim) is injected to keep this
// module free of an App import cycle.
export function applyTowerCashOut(
    character: Character,
    run: EndlessTowerRun,
    todayKey: string,
    gainXp: (c: Character, amount: number) => Character,
): Character {
    void todayKey; // retained in the signature for call-site stability
    const legacyXpAsRyo = Math.floor(Math.max(0, Math.floor(run.bankedXp)) * 0.75);
    const leveled = gainXp(character, 0);
    return {
        ...leveled,
        ryo: (leveled.ryo ?? 0) + run.bankedRyo + legacyXpAsRyo,
        endlessTowerBestWave: Math.max(leveled.endlessTowerBestWave ?? 0, run.wave),
        endlessTowerRun: null,
    };
}

// Celestial Tower kill-milestone rewards. Every 5 kills the player
// earns guaranteed shop currencies on top of the per-wave ryo/xp
// banking. Pattern cycles every 20 kills:
//   pos 0 (waves 5,  25, 45 …): 5 Bone Charms
//   pos 1 (waves 10, 30, 50 …): 5 Bone Charms
//   pos 2 (waves 15, 35, 55 …): 5 Fate Shards
//   pos 3 (waves 20, 40, 60 …): 5 Bone Charms + 5 Fate Shards
// Non-multiples of 5 return zero. Helper is pure data, called by
// handleEndlessWin in the wave-bump path so a death-clear still
// keeps everything already credited to the player's character.
export function endlessTowerMilestoneReward(wave: number): { boneCharms: number; fateShards: number } {
    if (wave <= 0 || wave % 5 !== 0) return { boneCharms: 0, fateShards: 0 };
    const cyclePos = (Math.floor(wave / 5) - 1) % 4;
    switch (cyclePos) {
        case 0:
        case 1:
            return { boneCharms: 5, fateShards: 0 };
        case 2:
            return { boneCharms: 0, fateShards: 5 };
        case 3:
            return { boneCharms: 5, fateShards: 5 };
        default:
            return { boneCharms: 0, fateShards: 0 };
    }
}
