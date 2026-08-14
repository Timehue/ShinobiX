// Matches the durable hit/miss request receipt. A cross-device recovery must
// never return a token after its active pointer has expired underneath it.
export const PET_ENCOUNTER_POINTER_TTL_SECONDS = 32 * 24 * 60 * 60;

export type PetEncounterPointer = {
    playerName: string;
    requestId: string;
    outcome: 'hit' | 'miss';
    token?: string;
    pet?: Record<string, unknown>;
    sector: number;
    mintedAt: number;
};

export function petEncounterActiveKey(playerName: string): string {
    return `pet-encounter-active:${playerName}`;
}

export function petEncounterRequestKey(playerName: string, requestId: string): string {
    return `pet-encounter-request:${playerName}:${requestId}`;
}

export function cleanPetEncounterPointer(raw: unknown): PetEncounterPointer | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const token = typeof value.token === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value.token)
        ? value.token
        : '';
    const pet = value.pet && typeof value.pet === 'object' && !Array.isArray(value.pet)
        ? value.pet as Record<string, unknown>
        : null;
    const outcome = value.outcome === 'miss' && !token && !pet ? 'miss' : token && pet ? 'hit' : null;
    const rawRequestId = typeof value.requestId === 'string' ? value.requestId.trim().slice(0, 96) : '';
    // Backward-compatible recovery for hit pointers minted before request IDs
    // became part of the durable cross-device authority.
    const requestId = /^[A-Za-z0-9_-]{8,96}$/.test(rawRequestId)
        ? rawRequestId
        : token
            ? `legacy_${token}`.slice(0, 96)
            : '';
    const sector = Math.floor(Number(value.sector));
    const mintedAt = Math.floor(Number(value.mintedAt));
    if (typeof value.playerName !== 'string' || !requestId || !outcome
        || !Number.isSafeInteger(sector) || sector < 1 || sector > 66
        || !Number.isSafeInteger(mintedAt) || mintedAt <= 0) return null;
    return {
        playerName: value.playerName,
        requestId,
        outcome,
        ...(outcome === 'hit' ? { token, pet: pet! } : {}),
        sector,
        mintedAt,
    };
}
