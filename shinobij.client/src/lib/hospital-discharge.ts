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

/** Read current healer state without allowing a retired account session to adopt it. */
export async function reconcileHealerSnapshot(
    accountKey: string,
    isCurrent: () => boolean,
    commit: VersionedCharacterCommit,
    onDischarged: () => void,
): Promise<boolean> {
    if (!isCurrent()) return false;
    const response = await fetch(`/api/save/${encodeURIComponent(accountKey)}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok || !isCurrent()) return false;
    const snapshot = await response.json() as HospitalDischargeResponse;
    if (!isCurrent()) return false;
    return adoptHealerSnapshot(snapshot, commit, onDischarged);
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
