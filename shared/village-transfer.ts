/** Shared marketplace and transfer contract. Story progress counts settled chapters. */
export const VILLAGE_TRANSFER_SCROLL_ID = 'village-transfer-scroll';
export const VILLAGE_TRANSFER_SCROLL_NAME = 'Village Transfer Scroll';
export const VILLAGE_TRANSFER_SCROLL_IMAGE = '/items/village-transfer-scroll-v1.webp';
export const VILLAGE_TRANSFER_COST = 250;
export const VILLAGE_TRANSFER_LEVEL = 100;
export const VILLAGE_TRANSFER_STORY_PROGRESS = 9;
export const TRANSFER_VILLAGES = [
    'Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village',
] as const;

export function villageTransferUnlockError(character: { level?: unknown; storyProgress?: unknown }): string | null {
    const level = Number(character.level);
    const progress = Number(character.storyProgress);
    return Number.isFinite(level) && level >= VILLAGE_TRANSFER_LEVEL
        && Number.isFinite(progress) && progress >= VILLAGE_TRANSFER_STORY_PROGRESS
        ? null : 'Reach level 100 and finish your village story to unlock village transfers.';
}

export function isTransferVillage(village: unknown): village is typeof TRANSFER_VILLAGES[number] {
    return typeof village === 'string' && (TRANSFER_VILLAGES as readonly string[]).includes(village);
}
