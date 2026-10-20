/** Food XP is independent of training, expedition and battle rewards. */
export const PET_FOOD_XP: Readonly<Record<string, number>> = {
    'pet-treat': 100, 'elemental-pet-treat': 250, 'ancient-pet-treat': 500, 'golden-apple': 2000,
};
export const PET_FOOD_DAILY_XP = 2000;
export const isPetFood = (id: string): boolean => Object.hasOwn(PET_FOOD_XP, id);
export const isCraftOnlyPetFood = (id: string): boolean => id === 'elemental-pet-treat' || id === 'ancient-pet-treat';
export function petFoodAllowance(pet: { foodXpDay?: unknown; foodXpUsed?: unknown }, now: number) {
    const day = Math.floor(now / 86_400_000);
    const used = pet.foodXpDay === day ? Math.max(0, Math.floor(Number(pet.foodXpUsed) || 0)) : 0;
    return { day, used, remaining: Math.max(0, PET_FOOD_DAILY_XP - used), resetsAt: (day + 1) * 86_400_000 };
}
