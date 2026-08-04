import type { HollowGateCombatKind, HollowGateCombatSettleResult } from "./hollow-gate-combat-api";

/** Identity only. Enemy stats, mechanics, vitals, and outcome live in the sealed Solo PvE session. */
export type HollowGatePveFightRef = {
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
};

export function formatHollowGateCombatReward(result: HollowGateCombatSettleResult): string {
    const reward = result.reward ?? {};
    return [
        reward.xp ? `+${reward.xp} XP` : "",
        reward.ryo ? `+${reward.ryo} ryo` : "",
        reward.auraDust ? `+${reward.auraDust} Aura Dust` : "",
        reward.honorSeals ? `+${reward.honorSeals} Honor Seals` : "",
        reward.boneCharms ? `+${reward.boneCharms} Bone Charms` : "",
        reward.fateShards ? `+${reward.fateShards} Fate Shards` : "",
        reward.hollowShards ? `+${reward.hollowShards} Hollow Shards` : "",
        reward.fragments ? `+${reward.fragments} Legendary Fragment` : "",
        reward.veils ? `+${reward.veils} Veil of the Hollow` : "",
        result.elementalShards ? `+${result.elementalShards} Elemental Shard` : "",
    ].filter(Boolean).join(", ");
}
