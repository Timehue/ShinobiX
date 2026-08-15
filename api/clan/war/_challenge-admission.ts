import type { ChallengeMode } from './_storage.js';

export const CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON =
    'Clan War shinobi 2v2 is unavailable until one server-owned four-player PvP lifecycle can settle the whole challenge.';

const PVP_2V2_PROGRESS_ACTIONS = new Set(['send', 'join-send', 'accept', 'join-accept']);

/**
 * The current PvP engine is a two-player lifecycle. Existing 2v2 queue records
 * may still be cancelled, declined, or left, but no action may progress one
 * toward combat until a four-player authority exists.
 */
export function clanWarChallengeAdmissionError(
    action: string,
    mode: ChallengeMode | string | undefined,
): string | null {
    return mode === 'pvp2v2' && PVP_2V2_PROGRESS_ACTIONS.has(action)
        ? CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON
        : null;
}
