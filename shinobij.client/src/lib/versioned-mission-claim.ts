import type { Character, VersionedCharacterCommit } from "../types/character";

type SuccessfulMissionClaim = {
    character?: Character;
    _saveVersion?: number;
};

/**
 * Adopt modern claim responses atomically through App's monotonic save-version
 * gate. `null` is reserved for rolling-deploy responses without a character.
 */
export function commitAuthoritativeMissionClaim(
    result: SuccessfulMissionClaim,
    commit: VersionedCharacterCommit,
): boolean | null {
    if (!result.character) return null;
    return commit(result.character, result._saveVersion);
}
