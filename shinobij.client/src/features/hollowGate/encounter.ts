/**
 * Hollow Gate — shrine encounter picking + scaling (pure).
 *
 * Extracted verbatim from App.startHollowGateBattle (App.tsx is at its line
 * budget) and extended for event variants: an event gate's final boss can be
 * ANY AI (variant.bossAiId) fought under the variant's own boss ramp, and the
 * encounter nameplate uses the variant's boss name. With no variant this
 * reproduces the original selection + scaling byte-for-byte, including the
 * Warden preference and the ±15-level bands.
 */
import { MAX_LEVEL } from "../../constants/game";
import { clampNumber } from "../../lib/utils";
import { hollowGateBossScaling } from "../../lib/hollow-gate-variant";
import type { CreatorAi } from "../../types/creator-ai";

// Elite-tile affixes: a tougher, flavored variant rolled for elite
// encounters. Build-time HP/stat modifiers only (no battle-engine changes)
// applied to the cloned shrine AI, plus a nameplate tag.
const HOLLOW_GATE_AFFIXES = [
    { name: "Colossal", hpMult: 1.4, statMult: 1.0 },
    { name: "Brutish", hpMult: 1.25, statMult: 1.05 },
    { name: "Savage", hpMult: 1.1, statMult: 1.12 },
    { name: "Frenzied", hpMult: 0.9, statMult: 1.2 },
] as const;

export type HollowGateEliteAffix = (typeof HOLLOW_GATE_AFFIXES)[number];

export type ShrineEncounterOpts = { isBoss?: boolean; isAmbush?: boolean; isBeast?: boolean; isElite?: boolean };

export type ShrineEncounterPick = {
    baseAi: CreatorAi;
    encounterName: string;
    rebasedLevel: number;
    bossHpMultiplier: number;
    eliteAffix: HollowGateEliteAffix | null;
};

export function scaleAffixStats(stats: CreatorAi["stats"], mult: number): CreatorAi["stats"] {
    return mult === 1 ? stats : (Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Math.max(1, Math.round(Number(v) * mult))])) as CreatorAi["stats"]);
}

/**
 * Pick + scale the opponent for a shrine encounter. Returns null when no AI
 * qualifies at all (the caller shows the "shrine refuses" notice).
 *
 * Boss tile prefers the variant's boss (any AI id) when set, then the
 * dedicated Hollow Gate Warden, then any boss-type AI within ±15 levels,
 * finally the closest boss overall. Ambush + normal battles pick a random
 * non-boss AI within ±15 levels (closest fallback).
 */
export function pickShrineEncounter(args: {
    playableAis: CreatorAi[];
    playerLevel: number;
    floor: number;
    maxFloor: number;
    bossDisplayName: string;
    variantBossAiId?: string;
    opts: ShrineEncounterOpts;
}): ShrineEncounterPick | null {
    const { playableAis, playerLevel, floor, maxFloor, bossDisplayName, variantBossAiId, opts } = args;
    const eliteAffix = opts.isElite ? HOLLOW_GATE_AFFIXES[Math.floor(Math.random() * HOLLOW_GATE_AFFIXES.length)] : null;
    const LEVEL_BAND = 15;
    const inBand = (ai: CreatorAi) => Math.abs((ai.level ?? 1) - playerLevel) <= LEVEL_BAND;

    const normalAis = playableAis.filter(ai => !ai.isBossAi);
    const bossAis = playableAis.filter(ai => ai.isBossAi);

    let chosen: CreatorAi | undefined;
    if (opts.isBoss) {
        // Event variants may point the final fight at ANY authored AI —
        // not just boss-typed ones — so admins can run bespoke event bosses.
        const variantBoss = variantBossAiId ? playableAis.find(ai => ai.id === variantBossAiId) : undefined;
        const warden = bossAis.find(ai => ai.id === "boss-hollow-gate-warden");
        const bossBand = bossAis.filter(inBand);
        if (variantBoss) {
            chosen = variantBoss;
        } else if (warden) {
            // Use the warden but rebase its level to the player's level so the
            // fight scales to the player. The encounter wrapper clones the AI.
            chosen = warden;
        } else if (bossBand.length > 0) {
            chosen = bossBand[Math.floor(Math.random() * bossBand.length)];
        } else if (bossAis.length > 0) {
            // Fall back to the boss closest in level.
            chosen = [...bossAis].sort((a, b) =>
                Math.abs((a.level ?? 1) - playerLevel) - Math.abs((b.level ?? 1) - playerLevel)
            )[0];
        }
    } else {
        const normalBand = normalAis.filter(inBand);
        if (normalBand.length > 0) {
            chosen = normalBand[Math.floor(Math.random() * normalBand.length)];
        } else if (normalAis.length > 0) {
            chosen = [...normalAis].sort((a, b) =>
                Math.abs((a.level ?? 1) - playerLevel) - Math.abs((b.level ?? 1) - playerLevel)
            )[0];
        }
    }
    if (!chosen) return null;
    const baseAi = chosen;

    const encounterName = opts.isBoss
        ? bossDisplayName
        : opts.isAmbush
            ? "Hollow Gate Ambush"
            : opts.isBeast
                ? `Hollow Beast: ${baseAi.name}`
                : eliteAffix
                    ? `${eliteAffix.name} ${baseAi.name}`
                    : `Corrupted ${baseAi.name}`;

    // Boss difficulty ramps over the run's OWN floor count (lib/hollow-gate-
    // variant): floor 1 at playerLevel −5 rising to +15 (and 1.0×…1.4× HP) on
    // the final floor. For the standard 5-floor shrine this reproduces the
    // original per-floor table exactly; a 1-floor event gate fights its boss
    // at full Warden strength.
    const scaling = hollowGateBossScaling(floor, maxFloor);
    const bossFloorOffset = opts.isBoss ? scaling.levelOffset : 0;
    const targetLevel = playerLevel + bossFloorOffset;
    const rebasedLevel = opts.isBoss
        ? clampNumber(targetLevel, 1, MAX_LEVEL)
        : clampNumber(baseAi.level ?? playerLevel, Math.max(1, playerLevel - LEVEL_BAND), playerLevel + LEVEL_BAND);
    const bossHpMultiplier = opts.isBoss ? scaling.hpMult : 1;

    return { baseAi, encounterName, rebasedLevel, bossHpMultiplier, eliteAffix };
}
