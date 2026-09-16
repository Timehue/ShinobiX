import type { VersionedCharacterCommit } from "../types/character";
import { recordSectorExplore, worldRewardFailureMessage, type FieldExploreProgress } from "./world-reward-api";
import { completeWorldRewardOperation, readPendingWorldRewards, type PendingWorldRewardOperation } from "./world-reward-recovery";

export type WorldRecoveryResult = { state: "none" | "recovered" | "blocked"; message?: string };

type ReportFailure = (message: string) => void;

export type WorldRewardDrainCallbacks = {
    continueWorldDiscovery: (operation: PendingWorldRewardOperation, interactive: boolean, reportFailure: ReportFailure) => Promise<"recovered" | "blocked" | "retired">;
    recoverPendingExternalDiscovery: (operation: PendingWorldRewardOperation, source: "pet" | "dungeon", reportFailure: ReportFailure) => Promise<boolean>;
    launchResolvedExploreBattle: (sector: number, requestId: string) => boolean;
    recordMissionExplore: (sector: number, requestId: string, fieldProgress?: FieldExploreProgress[]) => Promise<boolean>;
    settleDiscoveredChest: (operation: PendingWorldRewardOperation, reportFailure: ReportFailure) => Promise<"settled" | "retryable" | "terminal">;
    onDungeonFound: (token: string) => void;
    onVersionedCharacter: VersionedCharacterCommit;
};

/** Resume the durable queue in order; screen callbacks own presentation and save adoption. */
export async function drainPendingWorldRewardOperations(
    playerName: string,
    {
        continueWorldDiscovery,
        recoverPendingExternalDiscovery,
        launchResolvedExploreBattle,
        recordMissionExplore,
        settleDiscoveredChest,
        onDungeonFound,
        onVersionedCharacter,
    }: WorldRewardDrainCallbacks,
): Promise<WorldRecoveryResult> {
    const pending = readPendingWorldRewards(playerName);
    if (pending.length === 0) return { state: "none" };
    let blocked = false;
    let recovered = false;
    let retired = false;
    let discoveryFailure: string | undefined;
    for (const operation of pending) {
        if (!readPendingWorldRewards(playerName).some((current) => current.id === operation.id)) continue;
        if (operation.kind === "explore") {
            if (operation.discoveryStage) {
                const discovery = await continueWorldDiscovery(operation, false, (message) => { discoveryFailure = message; });
                if (discovery === "recovered") {
                    recovered = true;
                    break;
                }
                if (discovery === "retired") retired = true;
                else blocked = true;
                continue;
            }
            const result = await recordSectorExplore(
                playerName,
                operation.sector,
                operation.credit ?? "tile",
                operation.id,
                {
                    resolveOutcome: operation.resolveOutcome === true || !operation.externalOutcomeProof,
                    ...(operation.externalOutcomeProof ? { externalOutcomeProof: operation.externalOutcomeProof } : {}),
                },
            );
            if (!result.character) {
                let externalFailure: string | undefined;
                if (result.error === "pending-pet-discovery" || result.error === "pending-dungeon-discovery") {
                    const source = result.error === "pending-pet-discovery" ? "pet" : "dungeon";
                    if (await recoverPendingExternalDiscovery(operation, source, (message) => { externalFailure = message; })) {
                        discoveryFailure = externalFailure;
                        recovered = true;
                        break;
                    }
                }
                if (result.pendingBattle) { // this parked operation never committed; retire it and resume the owed ambush
                    completeWorldRewardOperation(playerName, operation.id);
                    if (launchResolvedExploreBattle(result.pendingBattle.sector, result.pendingBattle.requestId)) { recovered = true; break; }
                    blocked = true;
                    continue;
                }
                discoveryFailure = externalFailure ?? worldRewardFailureMessage(result);
                if (result.retryable === false) {
                    completeWorldRewardOperation(playerName, operation.id);
                    retired = true;
                } else {
                    blocked = true;
                }
                continue;
            }
            if (!onVersionedCharacter(result.character, result.saveVersion)) { blocked = true; continue; }
            if (await recordMissionExplore(operation.sector, operation.id, result.fieldProgress)) {
                if (result.outcome?.kind === "chest") {
                    const chestState = await settleDiscoveredChest(operation, (message) => { discoveryFailure = message; });
                    if (chestState === "settled") recovered = true;
                    else if (chestState === "terminal") retired = true;
                    else blocked = true;
                } else if (result.outcome?.kind === "battle") {
                    if (launchResolvedExploreBattle(operation.sector, operation.id)) {
                        recovered = true;
                        // AiFightHost clears the operation only after start
                        // ACK (or active-session resume), closing the crash gap.
                        break;
                    }
                    blocked = true;
                } else if (result.outcome?.kind === "external" && result.outcome.source === "dungeon"
                    && operation.externalOutcomeProof?.kind === "dungeon") {
                    onDungeonFound(operation.externalOutcomeProof.token);
                    completeWorldRewardOperation(playerName, operation.id);
                    recovered = true;
                    break;
                } else if (result.outcome?.kind === "external" && result.outcome.source === "pet") {
                    // Never surface a cached token directly. The request receipt
                    // can reconstruct an expired active pointer, or report that
                    // the choice already resolved on another device.
                    if (await recoverPendingExternalDiscovery(operation, "pet", (message) => { discoveryFailure = message; })) recovered = true;
                    else blocked = true;
                    break;
                } else {
                    completeWorldRewardOperation(playerName, operation.id);
                    recovered = true;
                }
            } else {
                blocked = true;
            }
            continue;
        }
        const chestState = await settleDiscoveredChest(operation, (message) => { discoveryFailure = message; });
        if (chestState === "settled") recovered = true;
        else if (chestState === "terminal") retired = true;
        else blocked = true;
    }
    if (blocked) return {
        state: "blocked",
        message: discoveryFailure ?? "A previous World reward could not be recovered yet. Explore again or reopen the map to retry.",
    };
    if (recovered) return { state: "recovered", message: discoveryFailure ?? "Your previous exploration was recovered. Explore again when you're ready." };
    if (retired) return {
        state: "recovered",
        message: discoveryFailure ?? "An expired World discovery was safely cleared. You can explore again now.",
    };
    return { state: "none" };
}
