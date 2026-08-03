import type { CreatorAi } from "../types/creator-ai";
import { aiJutsuLoadout, buildBasicCombatAiRules } from "./combat-ai";
import { starterJutsus } from "../data/jutsu";
import { maxChakraForLevel, maxStaminaForLevel } from "./stats";
import { aiStatsForLevel, aiArmorFactorFromRaw } from "./ai-stats";

/*
 * The onboarding "guaranteed first win" sparring dummy.
 *
 * Extracted from App.tsx so BOTH halves of the Academy spar build the same
 * opponent: this module is what the local fallback fight uses, and
 * api/story/_academy-spar.ts mirrors its constants for the sealed server fight.
 * `scripts/academy-spar-parity.test.ts` asserts the two stay identical — a
 * server dummy that drifted would quietly change the first minute of the game.
 *
 * Deliberately free of asset imports (the portrait is passed in): a `.webp`
 * import would make this module unloadable under node's test runner, which is
 * the same edge that keeps lib/ai-fight-loadout.ts separate from App.
 */

/** The dummy fights at level 1 — the player is level 1 too, so the band is peer. */
export const ACADEMY_SPAR_LEVEL = 1;

/** Deliberately tiny: it falls in a few hits, for a sub-60s first win. */
export const ACADEMY_SPAR_HP = 50;

export const ACADEMY_SPAR_LOADOUT_ID = "balanced" as const;

/** A couple of weak basic jutsu so the dummy pokes back (teaching that enemies
 *  act), while level-1 stats keep it from threatening the player. */
export const ACADEMY_SPAR_JUTSU_COUNT = 2;

/** The first two jutsu of the balanced loadout, resolved once so the server
 *  mirror can pin the same ids without importing the client catalog. */
export const academySparJutsuIds: string[] =
    aiJutsuLoadout(ACADEMY_SPAR_LOADOUT_ID, starterJutsus)
        .slice(0, ACADEMY_SPAR_JUTSU_COUNT)
        .map((jutsu) => jutsu.id);

/**
 * Build the local sparring dummy. `id` is supplied by the caller because the
 * two fight paths name it differently: the local fallback mints a
 * `temp-academy-spar-<ts>` id (which no server catalog can resolve, by design),
 * while the sealed server fight uses the stable `academy-spar-dummy`.
 */
export function buildAcademySparDummy(params: {
    id: string;
    village: string;
    image?: string;
}): CreatorAi {
    const jutsus = aiJutsuLoadout(ACADEMY_SPAR_LOADOUT_ID, starterJutsus).slice(0, ACADEMY_SPAR_JUTSU_COUNT);
    return {
        id: params.id,
        name: "Academy Training Dummy",
        icon: "🎯",
        image: params.image,
        level: ACADEMY_SPAR_LEVEL,
        village: params.village,
        hp: ACADEMY_SPAR_HP,
        chakra: maxChakraForLevel(ACADEMY_SPAR_LEVEL),
        stamina: maxStaminaForLevel(ACADEMY_SPAR_LEVEL),
        stats: aiStatsForLevel(ACADEMY_SPAR_LEVEL, jutsus),
        armorRawDR: 0,
        armorFactor: aiArmorFactorFromRaw(0),
        loadoutId: ACADEMY_SPAR_LOADOUT_ID,
        jutsuIds: jutsus.map((jutsu) => jutsu.id),
        rules: buildBasicCombatAiRules(jutsus, ACADEMY_SPAR_LOADOUT_ID),
    };
}
