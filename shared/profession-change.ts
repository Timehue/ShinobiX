/** Keep the existing item ID so previously purchased approvals become scrolls. */
export const PROFESSION_CHANGE_APPROVAL_ID = 'profession-change-approval';
export const PROFESSION_CHANGE_APPROVAL_NAME = 'Profession Change Scroll';
export const PROFESSION_CHANGE_APPROVAL_COST = 200;
export const PROFESSION_CHANGE_SCROLL_IMAGE = '/items/profession-change-scroll-v1.webp';
export const PROFESSION_UNLOCK_LEVEL = 13;
export const PROFESSION_CHANGE_LEVEL = 20;
export const PROFESSIONS = ['healer', 'vanguard', 'petTamer'] as const;

export function isProfession(value: unknown): value is typeof PROFESSIONS[number] {
    return PROFESSIONS.some(profession => profession === value);
}

export function professionChangeUnlockError(character: { level?: unknown; profession?: unknown }): string | null {
    const level = Number(character.level);
    if (!Number.isFinite(level) || level < PROFESSION_CHANGE_LEVEL) {
        return `Profession changes require Level ${PROFESSION_CHANGE_LEVEL}.`;
    }
    if (!isProfession(character.profession)) return 'Choose your first profession before buying or using a Profession Change Scroll.';
    return null;
}
