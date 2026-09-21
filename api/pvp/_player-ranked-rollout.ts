/**
 * Player-ranked authority is fully deployed. Admissions are now controlled by
 * the active season and the Admin Panel, rather than process environment.
 * Retained only as a compatibility shim for older callers.
 */
export function playerRankedV2AdmissionsEnabled(
    _env: Record<string, string | undefined> = process.env,
): boolean {
    return true;
}

export const PLAYER_RANKED_V2_DISABLED_MESSAGE =
    'Ranked PvP is not accepting new entries right now.';
