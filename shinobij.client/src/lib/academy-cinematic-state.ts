import type { Character } from "../types/character";
import { saveConflictAccountKey } from "./save-conflict";

const CINEMATIC_STEPS = ["academyIntro", "starter", "companionIntro", "training"];

/** Cinematic progress is local until autosave catches up. An unrelated server
 * mutation may predate the completed scene; retain only its step and vow, never
 * the optimistic pet, wallet, vitals or later server-backed Academy milestones. */
export function preserveAcademyCinematicState(authoritative: Character, local: Character | null | undefined): Character {
    const owner = saveConflictAccountKey(authoritative.name);
    if (!owner || !local || owner !== saveConflictAccountKey(local.name)) return authoritative;
    const serverStep = CINEMATIC_STEPS.indexOf(authoritative.onboardingStep ?? "");
    const localStep = CINEMATIC_STEPS.indexOf(local.onboardingStep ?? "");
    if (serverStep < 0 || localStep < 0 || localStep < serverStep) return authoritative;
    const academyVow = local.academyVow === "unbound" || local.academyVow === "seeker" || local.academyVow === "guardian"
        ? local.academyVow : authoritative.academyVow;
    if (serverStep === localStep && academyVow === authoritative.academyVow) return authoritative;
    return { ...authoritative, onboardingStep: local.onboardingStep, academyVow };
}
