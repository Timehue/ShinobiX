export type PlayerRankedAuthority = {
    rankedMatchId: string;
    rankedSeasonId: number;
    rankedSeasonEpoch: number;
};

const PLAYER_RANKED_MATCH_ID = /^player-ranked-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Parse the exact capability returned by /api/pvp/ranked-queue. */
export function playerRankedAuthorityFromQueueMatch(value: unknown): PlayerRankedAuthority | null {
    if (!isRecord(value)
        || typeof value.matchId !== 'string'
        || !PLAYER_RANKED_MATCH_ID.test(value.matchId)
        || !positiveSafeInteger(value.seasonId)
        || !positiveSafeInteger(value.seasonEpoch)) return null;
    return {
        rankedMatchId: value.matchId,
        rankedSeasonId: value.seasonId,
        rankedSeasonEpoch: value.seasonEpoch,
    };
}

/** Revalidate authority after it has crossed the durable challenge inbox. */
export function playerRankedAuthorityFromChallenge(value: unknown): PlayerRankedAuthority | null {
    if (!isRecord(value)
        || typeof value.rankedMatchId !== 'string'
        || !PLAYER_RANKED_MATCH_ID.test(value.rankedMatchId)
        || !positiveSafeInteger(value.rankedSeasonId)
        || !positiveSafeInteger(value.rankedSeasonEpoch)) return null;
    return {
        rankedMatchId: value.rankedMatchId,
        rankedSeasonId: value.rankedSeasonId,
        rankedSeasonEpoch: value.rankedSeasonEpoch,
    };
}
