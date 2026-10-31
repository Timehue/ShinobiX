import type { Character } from "../types/character";
import { reconcileOwnedStarter } from "./pet-acquisition-api";
import { saveConflictAccountKey } from "./save-conflict";

/** The starter commits when the player confirms it, while the cinematic is still
 * playing on the pre-grant step, and an autosave can persist that step. A reload
 * then finds an owned starter on a summon step: resume at the companion beat,
 * because the summon's picker would only be refused as already chosen. */
export function resumedStarterStep(character: Pick<Character, "onboardingStep" | "pets">): "companionIntro" | null {
    const onSummonStep = character.onboardingStep === "academyIntro" || character.onboardingStep === "starter";
    return onSummonStep && character.pets.length > 0 ? "companionIntro" : null;
}

/** Undo a refused or unreachable starter commit so the picker can run again. */
export function abandonStarterPet(current: Character | null, accountName: string, petId: string): Character | null {
    if (!current || current.name !== accountName) return current;
    return {
        ...current,
        pets: current.pets.filter((entry) => entry.id !== petId),
        activePetId: current.activePetId === petId ? undefined : current.activePetId,
        onboardingStep: "academyIntro",
    };
}

/** A committed grant can be superseded by another authoritative mutation before
 * its response arrives. Keep rejecting that older character while allowing the
 * cinematic to persist its handoff against the current save version. */
export function completeStarterPetCommit(
    current: Character,
    result: { character?: Character; _saveVersion?: number },
    optimisticPetId: string,
    authority: {
        activeAccountKey: string;
        latestVersion: number;
        commitCharacter: (character: Character, version: unknown) => boolean;
    },
): boolean {
    const ownerKey = saveConflictAccountKey(current.name);
    if (!ownerKey || ownerKey !== authority.activeAccountKey || !result.character
        || saveConflictAccountKey(result.character.name) !== ownerKey || !result.character.pets?.length) return false;
    const reconciled = reconcileOwnedStarter(current, result.character, optimisticPetId);
    if (authority.commitCharacter(reconciled, result._saveVersion)) return true;
    // A later save can supersede the starter receipt while its response is in
    // flight. Keep that newer character state, but still merge the one pet
    // minted by this receipt at the latest accepted version so its server-rolled
    // trait and stats replace the optimistic template copy.
    if (typeof result._saveVersion !== "number" || !Number.isSafeInteger(result._saveVersion)
        || result._saveVersion <= 0 || result._saveVersion >= authority.latestVersion) return false;
    return authority.commitCharacter(reconciled, authority.latestVersion);
}
