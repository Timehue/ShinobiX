import type { VersionedCharacterCommit } from '../types/character';
import { resourceRequest, type ResourceResponse } from './resource-api';

type RecoveryTarget = { id: string; nodeId: string };

/** Keep the version gate intact when another save overtakes the mount-time
 * status. One fresh status can reconcile that race; service failures and a
 * second rejected snapshot still require the player's explicit retry. */
export async function recoverResourceStatus({ playerName, attempt, commit, isCurrent, request = resourceRequest }: {
    playerName: string;
    attempt?: RecoveryTarget;
    commit: VersionedCharacterCommit;
    isCurrent: () => boolean;
    request?: typeof resourceRequest;
}): Promise<{ accepted: boolean; response: ResourceResponse; target?: RecoveryTarget } | null> {
    let target = attempt;
    for (let read = 0; read < 2; read++) {
        if (!isCurrent()) return null;
        const response = await request({ action: 'status', playerName, requestId: target?.id, nodeId: target?.nodeId });
        if (!isCurrent()) return null;
        const accepted = Boolean(response.ok && response.character && commit(response.character, response._saveVersion));
        // Status may itself close an interrupted attempt. Keep its receipt
        // address even when the latest character no longer contains active.
        const active = response.character?.resourceGathering?.active;
        const id = response.receipt?.id ?? active?.id ?? target?.id;
        const nodeId = response.nodeId ?? active?.nodeId ?? target?.nodeId;
        if (response.ok && response.character?.name === playerName && id && nodeId) target = { id, nodeId };
        if (accepted || !response.ok || !response.character || response.character.name !== playerName
            || !Number.isSafeInteger(response._saveVersion) || Number(response._saveVersion) <= 0 || read === 1) {
            return { accepted, response, target };
        }
    }
    return null;
}
