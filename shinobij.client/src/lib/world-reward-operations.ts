import { newWorldRewardRequestId, type ExploreCredit, type ExternalExploreProof } from "./world-reward-api";
import type { Pet } from "../types/pet";
import {
    completeWorldRewardOperation,
    defaultStorage,
    playerKey,
    readPendingWorldRewards,
    readSettledWorldDiscoveries,
    settledStorageKey,
    volatileSettled,
    writePendingWorldRewards,
    type PendingWorldRewardOperation,
    type WorldRewardRecoveryStorage,
} from "./world-reward-recovery";

// Opening and settling outbox entries happens only on the lazy World Map, so
// this stays out of the read and merge path that App.tsx loads at startup.
export type { PendingWorldRewardOperation } from "./world-reward-recovery";

const SETTLED_DISCOVERY_CAP = 64;

/** Persist before sending. An unresolved identical operation reuses its id, so
 * retry/reload can only replay the server's receipt rather than mint another. */
export function beginWorldRewardOperation(
    playerName: string,
    kind: "explore" | "chest",
    sector: number,
    credit?: ExploreCredit,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
    metadata: Pick<PendingWorldRewardOperation, "resolveOutcome" | "discoveryStage" | "externalOutcomeProof" | "petEncounter" | "worldExploreRequestId"> = {},
    operationId?: string,
): PendingWorldRewardOperation {
    const operations = readPendingWorldRewards(playerName, storage);
    const requestedId = typeof operationId === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(operationId)
        ? operationId
        : undefined;
    const exactIndex = requestedId ? operations.findIndex((entry) => entry.id === requestedId) : -1;
    if (exactIndex >= 0) {
        const exact = operations[exactIndex];
        const rebound: PendingWorldRewardOperation = {
            id: exact.id,
            playerName,
            kind,
            sector,
            ...(kind === "explore" ? { credit: credit ?? "tile" } : {}),
            ...(metadata.resolveOutcome ? { resolveOutcome: true } : {}),
            ...(metadata.discoveryStage ? { discoveryStage: metadata.discoveryStage } : {}),
            ...(metadata.externalOutcomeProof ? { externalOutcomeProof: metadata.externalOutcomeProof } : {}),
            ...(metadata.petEncounter ? { petEncounter: metadata.petEncounter } : {}),
            ...(metadata.worldExploreRequestId ? { worldExploreRequestId: metadata.worldExploreRequestId } : {}),
            createdAt: exact.createdAt,
        };
        const next = [...operations];
        next[exactIndex] = rebound;
        writePendingWorldRewards(playerName, next, storage);
        return rebound;
    }
    const prior = operations.find((entry) => (requestedId ? entry.id === requestedId : entry.kind === kind
        && entry.sector === sector
        && entry.credit === credit
        && entry.resolveOutcome === metadata.resolveOutcome
        && entry.discoveryStage === metadata.discoveryStage
        && entry.externalOutcomeProof?.kind === metadata.externalOutcomeProof?.kind
        && entry.externalOutcomeProof?.token === metadata.externalOutcomeProof?.token
        && entry.worldExploreRequestId === metadata.worldExploreRequestId));
    if (prior) return prior;
    const operation: PendingWorldRewardOperation = {
        id: requestedId ?? newWorldRewardRequestId(),
        playerName,
        kind,
        sector,
        ...(kind === "explore" ? { credit: credit ?? "tile" } : {}),
        ...(metadata.resolveOutcome ? { resolveOutcome: true } : {}),
        ...(metadata.discoveryStage ? { discoveryStage: metadata.discoveryStage } : {}),
        ...(metadata.externalOutcomeProof ? { externalOutcomeProof: metadata.externalOutcomeProof } : {}),
        ...(metadata.petEncounter ? { petEncounter: metadata.petEncounter } : {}),
        ...(metadata.worldExploreRequestId ? { worldExploreRequestId: metadata.worldExploreRequestId } : {}),
        createdAt: Date.now(),
    };
    writePendingWorldRewards(playerName, [...operations, operation], storage);
    return operation;
}

export function beginResolvedWorldExplore(
    playerName: string,
    sector: number,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
    operationId?: string,
): PendingWorldRewardOperation {
    return beginWorldRewardOperation(playerName, "explore", sector, "tile", storage, { resolveOutcome: true }, operationId);
}

export function beginWorldDiscoveryOperation(
    playerName: string,
    sector: number,
    discoveryStage: "dungeon" | "pet",
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
    operationId?: string,
): PendingWorldRewardOperation {
    return beginWorldRewardOperation(playerName, "explore", sector, "tile", storage, { discoveryStage }, operationId);
}

export function beginExternalWorldExplore(
    playerName: string,
    sector: number,
    externalOutcomeProof: ExternalExploreProof,
    petEncounter?: Pet,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
    operationId?: string,
): PendingWorldRewardOperation {
    return beginWorldRewardOperation(playerName, "explore", sector, "tile", storage, { externalOutcomeProof, petEncounter }, operationId);
}

export function beginWorldChestOperation(
    playerName: string,
    sector: number,
    worldExploreRequestId: string,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
): PendingWorldRewardOperation {
    return beginWorldRewardOperation(playerName, "chest", sector, undefined, storage, { worldExploreRequestId });
}

/**
 * Remember a chest discovery the server has finished with (paid, or definitively
 * refused). A save snapshot read before that answer can arrive after it, and
 * without this it would queue the same id again, which turns the next Explore
 * click into a replay of the old receipt.
 */
export function rememberSettledWorldDiscovery(
    playerName: string,
    discoveryId: string,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
): void {
    if (!playerName) return;
    const next = [
        ...readSettledWorldDiscoveries(playerName, storage).filter((entry) => entry.id !== discoveryId),
        { id: discoveryId, at: Date.now() },
    ].slice(-SETTLED_DISCOVERY_CAP);
    volatileSettled.set(playerKey(playerName), next);
    try {
        storage?.setItem(settledStorageKey(playerName), JSON.stringify(next));
    } catch { /* private mode keeps the in-memory copy for this page */ }
}

/**
 * Retire an outbox entry the World Map finished. A chest entry only ever gets
 * here once its discovery is settled, so a late server snapshot of that
 * discovery must not requeue it.
 */
export function settleWorldRewardOperation(
    playerName: string,
    operationId: string,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
): void {
    const operation = readPendingWorldRewards(playerName, storage).find((entry) => entry.id === operationId);
    if (operation?.kind === "chest" && operation.worldExploreRequestId) {
        rememberSettledWorldDiscovery(playerName, operation.worldExploreRequestId, storage);
    }
    completeWorldRewardOperation(playerName, operationId, storage);
}
