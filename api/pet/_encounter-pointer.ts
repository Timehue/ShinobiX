import { isWildSector } from '../../shared/sector-geo.js';

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
    caravanRunId?: string;
    battleRequired?: boolean;
};

export type PetAttemptReceipt = {
    version: 1;
    playerName: string;
    requestId: string;
    day: string;
    sector: number;
    mintedAt: number;
    token?: string;
    pet?: Record<string, unknown>;
    resolvedAt?: number;
    worldExploreRequestId?: string;
    caravanRunId?: string;
    trackerTrailId?: string;
    resolution?: 'explored-miss' | 'befriended' | 'declined' | 'expired';
    battleRequired?: boolean;
};

function cleanPetReceiptRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

export function cleanPetAttemptReceipt(raw: unknown): PetAttemptReceipt | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Partial<PetAttemptReceipt>;
    const sector = Math.floor(Number(value.sector));
    const mintedAt = Math.floor(Number(value.mintedAt));
    if (value.version !== 1 || typeof value.playerName !== 'string'
        || !cleanPetReceiptRequestId(value.requestId) || typeof value.day !== 'string'
        || !isWildSector(sector) || !Number.isSafeInteger(mintedAt) || mintedAt <= 0) return null;
    const token = typeof value.token === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value.token) ? value.token : undefined;
    const pet = value.pet && typeof value.pet === 'object' && !Array.isArray(value.pet)
        ? value.pet as Record<string, unknown>
        : undefined;
    if (Boolean(token) !== Boolean(pet)) return null;
    const resolvedAt = Math.floor(Number(value.resolvedAt));
    const worldExploreRequestId = cleanPetReceiptRequestId(value.worldExploreRequestId);
    const resolution = value.resolution === 'explored-miss'
        || value.resolution === 'befriended'
        || value.resolution === 'declined'
        || value.resolution === 'expired'
        ? value.resolution
        : undefined;
    return {
        version: 1,
        playerName: value.playerName,
        requestId: value.requestId!,
        day: value.day,
        sector,
        mintedAt,
        ...(token && pet ? { token, pet } : {}),
        ...(Number.isSafeInteger(resolvedAt) && resolvedAt > 0 ? { resolvedAt } : {}),
        ...(worldExploreRequestId ? { worldExploreRequestId } : {}),
        ...(typeof value.caravanRunId === 'string' ? { caravanRunId: value.caravanRunId } : {}),
        ...(typeof value.trackerTrailId === 'string' ? { trackerTrailId: value.trackerTrailId } : {}),
        ...(resolution ? { resolution } : {}),
        ...(value.battleRequired === true ? { battleRequired: true } : {}),
    };
}

/** A terminal request cannot own the next discovery, even if cleanup left its pointer. */
export function petEncounterPointerIsResolved(pointer: PetEncounterPointer, rawReceipt: unknown): boolean {
    const receipt = cleanPetAttemptReceipt(rawReceipt);
    return !!receipt?.resolvedAt
        && receipt.playerName.toLowerCase() === pointer.playerName.toLowerCase()
        && receipt.requestId === pointer.requestId
        && receipt.sector === pointer.sector
        && receipt.mintedAt === pointer.mintedAt;
}

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
        ...(typeof value.caravanRunId === 'string' ? { caravanRunId: value.caravanRunId } : {}),
        ...(value.battleRequired === true ? { battleRequired: true } : {}),
    };
}
