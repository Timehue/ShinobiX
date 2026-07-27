// Onboarding step normalization — the single source of truth for mapping a
// stored `character.onboardingStep` (which may be a legacy value from an older
// save) onto the canonical "Academy Path" flow:
//
//   academyIntro -> starter -> companionIntro -> training -> jutsu
//   -> jutsuLoadout -> inventory -> academySpar -> cafeteria -> firstMission
//   -> logbook -> sectorReturn -> done
//
// Legacy saves used a shorter flow ("starter → spar → tour → training → jutsu
// -> logbook -> done"). We never want to break those, so:
//   - "spar"          -> "academySpar" (renamed beat)
//   - "tour"          -> "training" (the overwhelming menu tour was removed)
//   - "storyUnlocked" -> "sectorReturn" (Story Hall is no longer a tutorial beat)
//   - undefined / null / "" -> "done" (pre-onboarding veterans never replay)
// Every other value passes through unchanged.
import type { Character } from "../types/character";
import { starterSavedBloodlines } from "../data/jutsu";

export type OnboardingStep = NonNullable<Character["onboardingStep"]>;

// The canonical steps the rest of the app routes on — legacy aliases removed.
export type CanonicalOnboardingStep = Exclude<OnboardingStep, "spar" | "tour" | "storyUnlocked">;

// New characters receive two complementary starter items (the Rustfang Kunai
// and Shinobi Vest). The Academy inventory beat should teach the full loadout,
// not advance after the first click and pull the player into the spar while the
// second item is still sitting in the backpack.
export const ACADEMY_STARTER_GEAR_TARGET = 2;
export const ACADEMY_STARTER_GEAR_IDS = ["rustfang-kunai", "shinobi-vest"] as const;
export const ACADEMY_JUTSU_LOADOUT_TARGET = 4;

export function hasAcademyTrainedExtraJutsu(
    character: Pick<Character, "bloodline" | "jutsuMastery">,
): boolean {
    const starterName = character.bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : character.bloodline;
    const starterJutsuIds = new Set(
        starterSavedBloodlines.find((bloodline) => bloodline.name === starterName)?.jutsus.map((jutsu) => jutsu.id) ?? [],
    );
    const mastery = character.jutsuMastery ?? [];
    if (starterJutsuIds.size === 0) {
        return mastery.length > ACADEMY_JUTSU_LOADOUT_TARGET;
    }
    return mastery.some((entry) => !starterJutsuIds.has(entry.jutsuId));
}

export function hasAcademyJutsuLoadoutComplete(
    character: Pick<Character, "equippedJutsuIds">,
): boolean {
    return (character.equippedJutsuIds?.length ?? 0) >= ACADEMY_JUTSU_LOADOUT_TARGET;
}

export function academyEquippedItemCount(equipment: Record<string, string | undefined> | null | undefined): number {
    const equippedItemIds = new Set(Object.values(equipment ?? {}).filter((itemId): itemId is string => Boolean(itemId)));
    return ACADEMY_STARTER_GEAR_IDS.filter((itemId) => equippedItemIds.has(itemId)).length;
}

export function hasAcademyStarterGearEquipped(equipment: Record<string, string | undefined> | null | undefined): boolean {
    return academyEquippedItemCount(equipment) >= ACADEMY_STARTER_GEAR_TARGET;
}

export function normalizeOnboardingStep(
    step: Character["onboardingStep"] | null | "",
): CanonicalOnboardingStep {
    if (!step) return "done";
    if (step === "spar") return "academySpar";
    if (step === "tour") return "training";
    if (step === "storyUnlocked") return "sectorReturn";
    return step;
}

export function isAcademyOnboardingActive(
    step: Character["onboardingStep"] | null | "",
): boolean {
    return normalizeOnboardingStep(step) !== "done";
}

export const ONBOARDING_STEP_ORDER: Record<CanonicalOnboardingStep, number> = {
    academyIntro: 0,
    starter: 1,
    companionIntro: 2,
    training: 3,
    jutsu: 4,
    jutsuLoadout: 5,
    inventory: 6,
    academySpar: 7,
    cafeteria: 8,
    firstMission: 9,
    logbook: 10,
    sectorReturn: 11,
    done: 12,
};

export function onboardingStepAtLeast(
    step: Character["onboardingStep"] | null | "",
    target: CanonicalOnboardingStep,
): boolean {
    const normalized = normalizeOnboardingStep(step);
    return ONBOARDING_STEP_ORDER[normalized] >= ONBOARDING_STEP_ORDER[target];
}
