import { newWorldRewardRequestId, type ExploreCredit, type ExternalExploreProof } from "./world-reward-api";
import type { Pet } from "../types/pet";
import {
    defaultStorage,
    readPendingWorldRewards,
    writePendingWorldRewards,
    type PendingWorldRewardOperation,
    type WorldRewardRecoveryStorage,
} from "./world-reward-recovery";

// Opening an outbox entry happens only on the lazy World Map, so this stays out
// of the read, merge and settle path that App.tsx loads at startup.
export { completeWorldRewardOperation, type PendingWorldRewardOperation } from "./world-reward-recovery";

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
