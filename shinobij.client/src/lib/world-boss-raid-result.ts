import type { WorldBossSettlement } from './world-boss-event-api';

export type WorldBossRaidReceipt = { bankedDamage: number; hpRemaining: number };

/** Both the event hub and the map queue display the same server-owned reward. */
export function worldBossRewardLine(reward: WorldBossSettlement['reward'] | undefined): string {
    if (!reward) return '';
    const contents = [...reward.itemIds.map(id => id.replace(/-/g, ' ')), ...(reward.gearDrop ? ['weapon or armor'] : [])];
    return `+${reward.ryo.toLocaleString()} Ryo · +${reward.statPoints} stats · +${reward.boneCharms} Bone Charms${contents.length ? ` · ${contents.join(' · ')}` : ''}`;
}

/** Only the shared-health receipt can confirm a world-boss defeat. */
export function worldBossRaidResult(winner: string | null, receipt?: WorldBossRaidReceipt) {
    const defeated = receipt?.hpRemaining === 0;
    return {
        title: defeated ? "World boss defeated" : winner === "squad" ? "Boss driven back" : "The raid has ended",
        objective: defeated ? "Shared boss health depleted" : "Raid damage contributed",
        detail: receipt
            ? defeated
                ? "Your team contribution is banked. The shared boss health is depleted. Return to the World Boss event for your reward receipt."
                : "Your team contribution is banked. The boss still has shared health remaining. Rally another team to keep fighting."
            : "A team raid contributes damage to the shared boss health. The world boss is defeated only when that health reaches zero.",
    };
}
