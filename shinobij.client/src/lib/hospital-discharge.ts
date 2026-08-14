import type { Character, VersionedCharacterCommit } from "../types/character";
import type { Screen } from "../types/core";

export type HospitalDischargeResponse = {
    character?: Character;
    _saveVersion?: unknown;
};

/** Commit the server's exact discharge snapshot before evaluating navigation. */
export function adoptHospitalDischarge(
    response: HospitalDischargeResponse,
    commit: VersionedCharacterCommit,
    navigate: (screen: Screen, authoritativeCharacter: Character) => void,
): boolean {
    const next = response.character;
    if (!next || next.hospitalized === true) return false;
    if (!commit(next, response._saveVersion)) return false;
    navigate("village", next);
    return true;
}
