// Onboarding step normalization — the single source of truth for mapping a
// stored `character.onboardingStep` (which may be a legacy value from an older
// save) onto the canonical "Academy Path" flow:
//
//   academyIntro → starter → academySpar → training → jutsu → firstMission
//   → logbook → storyUnlocked → done
//
// Legacy saves used a shorter flow ("starter → spar → tour → training → jutsu
// → logbook → done"). We never want to break those, so:
//   • "spar"  → "academySpar"   (renamed beat)
//   • "tour"  → "training"       (the overwhelming menu tour was removed; its
//                                 slot is now the single "go train" objective)
//   • undefined / null / ""      → "done"  (pre-onboarding veterans never replay)
// Every other value passes through unchanged.
import type { Character } from "../types/character";

export type OnboardingStep = NonNullable<Character["onboardingStep"]>;

// The canonical steps the rest of the app routes on — legacy aliases removed.
export type CanonicalOnboardingStep = Exclude<OnboardingStep, "spar" | "tour">;

export function normalizeOnboardingStep(
    step: Character["onboardingStep"] | null,
): CanonicalOnboardingStep {
    if (!step) return "done";
    if (step === "spar") return "academySpar";
    if (step === "tour") return "training";
    return step;
}
