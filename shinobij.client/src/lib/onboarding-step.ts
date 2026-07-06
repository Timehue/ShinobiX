// Onboarding step normalization — the single source of truth for mapping a
// stored `character.onboardingStep` (which may be a legacy value from an older
// save) onto the canonical "Academy Path" flow:
//
//   academyIntro -> starter -> training -> jutsu -> jutsuLoadout -> inventory
//   -> academySpar -> cafeteria -> firstMission -> logbook -> sectorReturn -> done
//
// Legacy saves used a shorter flow ("starter → spar → tour → training → jutsu
// -> logbook -> done"). We never want to break those, so:
//   - "spar"          -> "academySpar" (renamed beat)
//   - "tour"          -> "training" (the overwhelming menu tour was removed)
//   - "storyUnlocked" -> "sectorReturn" (Story Hall is no longer a tutorial beat)
//   - undefined / null / "" -> "done" (pre-onboarding veterans never replay)
// Every other value passes through unchanged.
import type { Character } from "../types/character";

export type OnboardingStep = NonNullable<Character["onboardingStep"]>;

// The canonical steps the rest of the app routes on — legacy aliases removed.
export type CanonicalOnboardingStep = Exclude<OnboardingStep, "spar" | "tour" | "storyUnlocked">;

export function normalizeOnboardingStep(
    step: Character["onboardingStep"] | null | "",
): CanonicalOnboardingStep {
    if (!step) return "done";
    if (step === "spar") return "academySpar";
    if (step === "tour") return "training";
    if (step === "storyUnlocked") return "sectorReturn";
    return step;
}

export const ONBOARDING_STEP_ORDER: Record<CanonicalOnboardingStep, number> = {
    academyIntro: 0,
    starter: 1,
    training: 2,
    jutsu: 3,
    jutsuLoadout: 4,
    inventory: 5,
    academySpar: 6,
    cafeteria: 7,
    firstMission: 8,
    logbook: 9,
    sectorReturn: 10,
    done: 11,
};

export function onboardingStepAtLeast(
    step: Character["onboardingStep"] | null | "",
    target: CanonicalOnboardingStep,
): boolean {
    const normalized = normalizeOnboardingStep(step);
    return ONBOARDING_STEP_ORDER[normalized] >= ONBOARDING_STEP_ORDER[target];
}
