import type { ChallengeMode } from './_storage.js';

/**
 * Clan War shinobi 2v2 progression was fail-closed while no four-player PvP
 * lifecycle existed that could settle a whole challenge. One now does: the
 * Tower MPvP engine (api/towers/_pvp-session.ts) runs the fight with teams
 * fixed by clan, and api/clan/war/_mpvp-settlement.ts applies the war HP under
 * a durable exactly-once receipt.
 *
 * The gate is retained as an explicit, testable seam rather than deleted, so a
 * future engine outage can re-close the mode without reverting a feature.
 */
export const CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON =
    'Clan War shinobi 2v2 is temporarily unavailable.';

const PVP_2V2_PROGRESS_ACTIONS = new Set(['send', 'join-send', 'accept', 'join-accept']);

/**
 * Emergency rollback switch. Cancel/decline/leave stay available even when set,
 * so a retained queue record can always be cleared.
 */
export function clanWarPvp2v2Disabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_CLAN_WAR_PVP_2V2 === '1';
}

export function clanWarChallengeAdmissionError(
    action: string,
    mode: ChallengeMode | string | undefined,
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    return mode === 'pvp2v2' && PVP_2V2_PROGRESS_ACTIONS.has(action) && clanWarPvp2v2Disabled(env)
        ? CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON
        : null;
}
