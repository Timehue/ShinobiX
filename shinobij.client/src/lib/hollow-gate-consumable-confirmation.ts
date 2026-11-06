import type { HollowGateShrineRun, VersionedCharacterCommit } from "../types/character";
import { HOLLOW_SHARD_CONSUMABLES } from "./hollow-gate-shards";
import { requestHollowGateServerConsumable } from "./hollow-gate-server";
import { markHollowGateSeen } from "./hollow-gate-path";

export type HollowGateConsumableScope = { run: HollowGateShrineRun; playerName: string };
type Confirmation = {
    current: () => HollowGateConsumableScope | null;
    setRun: (run: HollowGateShrineRun) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    pushLog: (line: string) => void;
};

/** Keep a paid receipt, but apply its run effects only to its original floor. */
export async function activateHollowGateConsumable(id: string, requested: HollowGateConsumableScope, confirm: Confirmation): Promise<void> {
    const { run, playerName } = requested;
    if (!run.runToken) {
        confirm.pushLog("Shrine relics cannot be used in this older run. Leave and start a new run to use them.");
        return;
    }
    const actions = {
        reignite: "reignite", "skeleton-key": "skeleton-key", "hollow-ward": "hollow-ward",
        "diviner-eye": "diviner-eye", sanctify: "sanctify", "second-wind": "arm-second-wind",
    } as const;
    const action = actions[id as keyof typeof actions];
    if (!action) return confirm.pushLog("Unknown shrine relic.");
    const result = await requestHollowGateServerConsumable(playerName, run.runToken, action);
    const current = confirm.current();
    // The run owner survives combat unmounts; a closed run or another account does not.
    if (!current || current.playerName !== playerName) return;
    const latest = current.run;
    const sameFloor = latest.runToken === run.runToken && latest.floor === run.floor && !latest.completed;
    if (!result?.ok || !result.character || !result.runState) {
        if (sameFloor) confirm.pushLog(result?.error ?? "The relic use could not be confirmed. Check your run before trying again.");
        return;
    }
    let nextRun = latest;
    if (sameFloor) {
        const confirmed: HollowGateShrineRun = {
            ...latest,
            keys: result.runState.keys,
            torch: result.runState.torch,
            threat: result.runState.threat,
            wardSteps: result.runState.wardSteps,
            diviner: result.runState.divinerUsed || latest.diviner,
            secondWindArmed: result.runState.secondWindArmed,
            entryCurrencies: result.entryCurrencies ?? latest.entryCurrencies,
        };
        nextRun = confirmed.diviner ? markHollowGateSeen(confirmed) : confirmed;
    }
    // Preserve purchase accounting through the versioned coordinator (including
    // its stale-receipt readback), without replacing a newer floor/run projection.
    confirm.onVersionedCharacter({ ...result.character, hollowGateRun: nextRun }, result._saveVersion);
    if (!sameFloor) return;
    // A refused stale character receipt must still display the confirmed relic
    // on this floor, so pressing it again cannot spend under a new request id.
    confirm.setRun(nextRun);
    const consumable = HOLLOW_SHARD_CONSUMABLES.find((entry) => entry.id === id);
    confirm.pushLog(`${consumable?.label ?? "Shrine relic"} activated.`);
}
