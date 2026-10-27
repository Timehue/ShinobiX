import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import type { ShowdownSession } from '../_pet-showdown/engine.js';
import { arenaAdmissionId, showdownAdmissionKey } from '../pet/_showdown-admission.js';

export type ActivityPetRecovery = {
    title: string;
    screen: 'petColiseum';
    runtimeModeId: 'pet-coliseum';
    context: 'companions';
};

export type ActivityPetRecoveryReaders = {
    readSession: (playerName: string, sessionId: string) => Promise<ShowdownSession | null>;
};

const defaultReaders: ActivityPetRecoveryReaders = {
    readSession: (playerName, sessionId) => kv.get<ShowdownSession>(showdownAdmissionKey(playerName, sessionId)),
};

/**
 * A paid Pet Coliseum bout leaves its session id on the save, and starting the
 * Coliseum again resumes it (api/pet/showdown.ts), but nothing pointed the
 * player back to it. This discovers one with the same three checks the resume
 * path uses. It only reads, and a storage failure propagates so the Activity
 * Spine fails closed rather than hiding a live fight.
 */
export async function discoverActivityPetRecovery(
    playerName: string,
    character: Record<string, unknown>,
    readers: ActivityPetRecoveryReaders = defaultReaders,
): Promise<ActivityPetRecovery | null> {
    const slug = safeName(playerName);
    const sessionId = arenaAdmissionId(character);
    if (!slug || !sessionId) return null;
    const session = await readers.readSession(slug, sessionId);
    if (session?.playerName !== slug || !session.rewardEligible || session.finished) return null;
    return {
        title: 'Resume your Pet Coliseum bout',
        screen: 'petColiseum',
        runtimeModeId: 'pet-coliseum',
        context: 'companions',
    };
}
