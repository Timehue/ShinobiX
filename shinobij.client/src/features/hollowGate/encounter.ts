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
import { aiStatsForLevel, aiHpForLevel } from "../../lib/ai-stats";
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

// Per-floor "progressively harder" ramp for NON-boss shrine enemies: every
// floor of depth stiffens the Hollow Hounds you meet, so a full descent bites
// harder the deeper you go. Floor 1 = baseline (1.0×), exactly as
// before. The boss keeps its own, stronger level+HP ramp (hollowGateBossScaling)
// and is deliberately NOT touched by these — it's already the run's peak.
// Absolute-floor based (floor 8 is floor 8, whatever the gate length), so a
// short event gate simply never reaches the steep end of the ramp.
export const HOLLOW_GATE_FLOOR_HP_STEP = 0.06;    // +6% enemy HP per floor of depth
export const HOLLOW_GATE_FLOOR_STAT_STEP = 0.035; // +3.5% enemy stats per floor of depth

// Rift threat-ambush foes are trash MOBS, not fair duels: after the peer rebuild
// (see pickShrineEncounter) their stats AND HP are scaled by this — 0.9× reads as
// a speed-bump the player rolls through. Tunable.
export const RIFT_MOB_SCALE = 0.9;

export type ShrineEncounterOpts = { isBoss?: boolean; isAmbush?: boolean; isBeast?: boolean; isElite?: boolean };

export type ShrineEncounterPick = {
    baseAi: CreatorAi;
    encounterName: string;
    rebasedLevel: number;
    bossHpMultiplier: number;
    // Depth ramp for non-boss enemies (1.0 on floor 1, 1.0 for the boss).
    // Composes with the elite affix / augment / pet pre-damage in App.
    floorHpMult: number;
    floorStatMult: number;
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
 * dedicated Hollow Hound Alpha, then any boss-type AI within ±15 levels,
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
    /** Rebuild non-boss ambushes as a fair PEER (rift tone-down). See below. */
    gentleNonBoss?: boolean;
    opts: ShrineEncounterOpts;
}): ShrineEncounterPick | null {
    const { playableAis, playerLevel, floor, maxFloor, bossDisplayName, variantBossAiId, gentleNonBoss, opts } = args;
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
    // Rift (and other "gentle") non-boss ambushes: rebuild the picked foe as a
    // trash MOB — a peer stat/HP block at the player's level, then RIFT_MOB_SCALE
    // (0.9×) so it reads as a speed-bump, not a fair duel. The ±15-level pick only
    // clamps the NAMEPLATE, so without this a beefy hunt-tier AI (its OWN authored
    // stats + big HP pool) could ambush the player inside a short, gentle gate.
    // Bosses keep their own (stronger) ramp.
    const gentle = Boolean(gentleNonBoss) && !opts.isBoss;
    const baseAi: CreatorAi = gentle
        ? {
            ...chosen,
            stats: scaleAffixStats(aiStatsForLevel(playerLevel), RIFT_MOB_SCALE),
            hp: Math.max(1, Math.floor(aiHpForLevel(playerLevel) * RIFT_MOB_SCALE)),
        }
        : chosen;

    const encounterName = opts.isBoss
        ? bossDisplayName
        : opts.isAmbush
            ? "Ambushing Hollow Hound"
            : eliteAffix
                ? `${eliteAffix.name} Hollow Hound`
                : "Hollow Hound";
    // Defensive legacy theming: this picker is retained for old event helpers,
    // but any non-boss result must still present the canonical Hound identity.
    const themedBaseAi = opts.isBoss
        ? baseAi
        : {
            ...baseAi,
            name: encounterName,
            icon: "🐺",
            image: "/pet-poses/mythic-4-idle.webp",
        };

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
        : gentle
            ? clampNumber(playerLevel, 1, MAX_LEVEL)
            : clampNumber(baseAi.level ?? playerLevel, Math.max(1, playerLevel - LEVEL_BAND), playerLevel + LEVEL_BAND);
    const bossHpMultiplier = opts.isBoss ? scaling.hpMult : 1;

    // Non-boss depth ramp — deeper floors send tougher Hollow Hounds.
    const depth = Math.max(0, floor - 1);
    const floorHpMult = opts.isBoss ? 1 : 1 + depth * HOLLOW_GATE_FLOOR_HP_STEP;
    const floorStatMult = opts.isBoss ? 1 : 1 + depth * HOLLOW_GATE_FLOOR_STAT_STEP;

    return { baseAi: themedBaseAi, encounterName, rebasedLevel, bossHpMultiplier, floorHpMult, floorStatMult, eliteAffix };
}
