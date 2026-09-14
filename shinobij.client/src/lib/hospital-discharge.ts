import type { Character, VersionedCharacterCommit } from "../types/character";
import type { Screen } from "../types/core";

export type HospitalDischargeResponse = {
    character?: Character;
    _saveVersion?: unknown;
    chargedRyo?: number;
    alreadyDischarged?: boolean;
};

export function hospitalDischargeMessage(response: HospitalDischargeResponse): string {
    const charge = Math.max(0, Number(response.chargedRyo) || 0);
    const receipt = response.alreadyDischarged ? 'Discharge confirmed.'
        : charge > 0 ? `Discharged for ${charge.toLocaleString()} ryo.` : 'Discharged free.';
    return `${receipt} HP restored. Chakra and stamina recover with rest or a meal at the Cafeteria.`;
}

/** A notification is only a reason to read the save, never evidence of healing. */
export function adoptHealerSnapshot(
    response: HospitalDischargeResponse,
    commit: VersionedCharacterCommit,
    onDischarged: () => void,
): boolean {
    const next = response.character;
    if (!next || !commit(next, response._saveVersion)) return false;
    if (next.hospitalized !== true && next.hp > 0) onDischarged();
    return true;
}

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
