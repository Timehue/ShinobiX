export type CompanionSummonPet = {
    level?: number;
    unlockedForPve?: boolean;
};

/** Explain the hard level boundary; keep every other absent seal generic. */
export function unavailableCompanionSummonCopy(activePet: CompanionSummonPet | undefined): {
    short: string;
    title: string;
} {
    const level = Math.max(0, Math.floor(Number(activePet?.level) || 0));
    if (activePet && level < 50) {
        return {
            short: `Unlocks at pet Lv 50 · currently Lv ${level}`,
            title: `This active pet unlocks for PvE summons at pet level 50; currently level ${level}.`,
        };
    }
    return {
        short: "No eligible active pet",
        title: "Choose an eligible active PvE pet in the Pet Yard",
    };
}
