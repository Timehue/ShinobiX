import type { Character } from "../types/character";
import { reconcileOwnedStarter } from "./pet-acquisition-api";
import { saveConflictAccountKey } from "./save-conflict";

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
    if (authority.commitCharacter(reconcileOwnedStarter(current, result.character, optimisticPetId), result._saveVersion)) return true;
    return typeof result._saveVersion === "number" && Number.isSafeInteger(result._saveVersion)
        && result._saveVersion > 0 && result._saveVersion < authority.latestVersion;
}
