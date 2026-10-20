type WeeklyRewardStatus = {
    rewardsDistributed?: boolean;
    creditedPlayers?: readonly string[];
    distributionSummary?: readonly { name: string }[];
};

/** An expired event or a scheduled payout alone does not prove personal delivery. */
export function weeklyBossRewardConfirmed(boss: WeeklyRewardStatus, name: string): boolean {
    const me = name.trim().toLowerCase();
    if (!me) return false;
    if (boss.creditedPlayers?.some(player => player.toLowerCase() === me)) return true;
    // Historical events can omit individual markers. Their completed distribution
    // flag confirms delivery to everyone listed in the allocation summary.
    return boss.rewardsDistributed === true && boss.distributionSummary?.some(entry => entry.name.toLowerCase() === me) === true;
}
