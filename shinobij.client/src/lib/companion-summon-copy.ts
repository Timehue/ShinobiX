export type CompanionSummonPet = {
    level?: number;
    unlockedForPve?: boolean;
};

/**
 * Explain only the authority's explicit locked-and-under-50 branch. Every
 * other absent seal can be caused by roster, activity, or server state and must
 * retain generic copy rather than guessing on the client.
 */
export function unavailableCompanionSummonCopy(activePet: CompanionSummonPet | undefined): {
    short: string;
    title: string;
} {
    const level = Math.max(0, Math.floor(Number(activePet?.level) || 0));
    if (activePet?.unlockedForPve === false && level < 50) {
        return {
            short: `Unlocks at pet Lv 50 · currently Lv ${level}`,
            title: `This active pet is still locked for PvE summons. It unlocks at pet level 50; currently level ${level}.`,
        };
    }
    return {
        short: "No eligible active pet",
        title: "Choose an eligible active PvE pet in the Pet Yard",
    };
}
