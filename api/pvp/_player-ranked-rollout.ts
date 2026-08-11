/**
 * Player-ranked v2 is a two-stage rollout because d76a move workers use an
 * unconditional session write and cannot honor the new exact-CAS close fence.
 * Deploy/drain every worker first; only then set the exact enable flag to `1`.
 */
export function playerRankedV2AdmissionsEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env.ENABLE_PLAYER_RANKED_V2 === '1'
        && env.DISABLE_PLAYER_RANKED_V2 !== '1';
}

export const PLAYER_RANKED_V2_DISABLED_MESSAGE =
    'Ranked PvP is temporarily unavailable while the v2 authority rollout completes.';
