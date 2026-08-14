import {
    newWorldRewardRequestId,
    type ExploreCredit,
    type ExternalExploreProof,
} from "./world-reward-api";
import { playerSlug } from "./utils";
import type { Pet } from "../types/pet";

export type WorldRewardRecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingWorldRewardOperation = {
    id: string;
    playerName: string;
    kind: "explore" | "chest";
    sector: number;
    credit?: ExploreCredit;
    resolveOutcome?: boolean;
    /** Durable pre-outcome stage. Lost probe ACKs replay this exact request id. */
    discoveryStage?: "dungeon" | "pet";
    externalOutcomeProof?: ExternalExploreProof;
    /** Presentation only; `/pet/befriend` still resolves the token's sealed pet. */
    petEncounter?: Pet;
    /** Chest payout is bound to this exact server-rolled discovery. */
    worldExploreRequestId?: string;
    createdAt: number;
};

const KEY_PREFIX = "worldRewardRecovery.v1:";
// Server receipts/discovery authority can remain valid for weeks. Pruning at
// 24h silently converted a recoverable lost ACK into a second payable action.
export const WORLD_REWARD_RECOVERY_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const volatileOperations = new Map<string, PendingWorldRewardOperation[]>();

const playerKey = (playerName: string) => playerSlug(playerName);
const storageKey = (playerName: string) => `${KEY_PREFIX}${playerKey(playerName)}`;

function defaultStorage(): WorldRewardRecoveryStorage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export function readPendingWorldRewards(
    playerName: string,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
): PendingWorldRewardOperation[] {
    if (!playerName) return [];
    const key = playerKey(playerName);
    if (!storage) return [...(volatileOperations.get(key) ?? [])];
    try {
        const raw = storage.getItem(storageKey(playerName));
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        const expectedPlayer = playerKey(playerName);
        const seen = new Set<string>();
        const valid = parsed
            .filter((entry): entry is PendingWorldRewardOperation => !!entry && typeof entry === "object"
                && typeof (entry as PendingWorldRewardOperation).id === "string"
                && /^[A-Za-z0-9_-]{8,96}$/.test((entry as PendingWorldRewardOperation).id)
                && playerKey((entry as PendingWorldRewardOperation).playerName) === expectedPlayer
                && ((entry as PendingWorldRewardOperation).kind === "explore" || (entry as PendingWorldRewardOperation).kind === "chest")
                && Number.isSafeInteger((entry as PendingWorldRewardOperation).sector)
                && (entry as PendingWorldRewardOperation).sector >= 1
                && ((entry as PendingWorldRewardOperation).discoveryStage === undefined
                    || (entry as PendingWorldRewardOperation).discoveryStage === "dungeon"
                    || (entry as PendingWorldRewardOperation).discoveryStage === "pet")
                && Number.isFinite((entry as PendingWorldRewardOperation).createdAt)
                && now - (entry as PendingWorldRewardOperation).createdAt <= WORLD_REWARD_RECOVERY_MAX_AGE_MS)
            .filter((entry) => {
                if (seen.has(entry.id)) return false;
                seen.add(entry.id);
                if (entry.kind === "chest") {
                    return typeof entry.worldExploreRequestId === "string"
                        && /^[A-Za-z0-9_-]{8,96}$/.test(entry.worldExploreRequestId);
                }
                if (entry.credit !== "full" && entry.credit !== "tile") return false;
                const proof = entry.externalOutcomeProof;
                return !proof || ((proof.kind === "dungeon" || proof.kind === "pet")
                    && /^[A-Za-z0-9]{8,96}$/.test(proof.token));
            })
            .slice(-8);
        if (JSON.stringify(valid) !== JSON.stringify(parsed)) writePendingWorldRewards(playerName, valid, storage);
        return valid;
    } catch {
        return [...(volatileOperations.get(key) ?? [])];
    }
}

function writePendingWorldRewards(
    playerName: string,
    operations: PendingWorldRewardOperation[],
    storage: WorldRewardRecoveryStorage | null,
): void {
    if (!playerName) return;
    const key = playerKey(playerName);
    if (operations.length === 0) volatileOperations.delete(key);
    else volatileOperations.set(key, operations.slice(-8));
    if (!storage) return;
    try {
        if (operations.length === 0) storage.removeItem(storageKey(playerName));
        else storage.setItem(storageKey(playerName), JSON.stringify(operations.slice(-8)));
    } catch { /* private mode retains server idempotency for the live request */ }
}

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

export function completeWorldRewardOperation(
    playerName: string,
    operationId: string,
    storage: WorldRewardRecoveryStorage | null = defaultStorage(),
): void {
    writePendingWorldRewards(
        playerName,
        readPendingWorldRewards(playerName, storage).filter((entry) => entry.id !== operationId),
        storage,
    );
}
