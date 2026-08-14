export const WORLD_EXPLORE_RECEIPT_TTL_SECONDS = 32 * 24 * 60 * 60;

export type WorldExploreAuthorityReceipt = {
    version: 1;
    playerName: string;
    requestId: string;
    sector: number;
    reward: Record<string, unknown>;
    outcome?: Record<string, unknown>;
    petMissRequestId?: string;
    at: number;
};

export function worldExploreAuthorityKey(playerName: string, requestId: string): string {
    return `world-explore-receipt:${playerName}:${requestId}`;
}

export function cleanWorldExploreAuthorityReceipt(raw: unknown): WorldExploreAuthorityReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const requestId = typeof value.requestId === 'string' ? value.requestId.trim().slice(0, 96) : '';
    const sector = Math.floor(Number(value.sector));
    const at = Math.floor(Number(value.at));
    if (value.version !== 1 || typeof value.playerName !== 'string'
        || !/^[A-Za-z0-9_-]{8,96}$/.test(requestId)
        || !Number.isSafeInteger(sector) || sector < 1 || sector > 66
        || !Number.isSafeInteger(at) || at <= 0
        || !value.reward || typeof value.reward !== 'object' || Array.isArray(value.reward)) return null;
    const outcome = value.outcome && typeof value.outcome === 'object' && !Array.isArray(value.outcome)
        ? value.outcome as Record<string, unknown>
        : undefined;
    const petMissRequestId = typeof value.petMissRequestId === 'string'
        && /^[A-Za-z0-9_-]{8,96}$/.test(value.petMissRequestId)
        ? value.petMissRequestId
        : undefined;
    return {
        version: 1,
        playerName: value.playerName,
        requestId,
        sector,
        reward: value.reward as Record<string, unknown>,
        ...(outcome ? { outcome } : {}),
        ...(petMissRequestId ? { petMissRequestId } : {}),
        at,
    };
}
