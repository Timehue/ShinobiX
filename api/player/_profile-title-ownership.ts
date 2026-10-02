import { isKnownEarnedTitle, isServerCreditedTitle, normalizeTitleKey } from '../_titles-registry.js';

/**
 * Profile title ownership must match the trust source that grants the title.
 * Achievement titles retain the historical earnedTitles source, while server
 * honors (including era campaign titles) require the server-owned vault.
 */
export function ownsKnownProfileTitle(character: Record<string, unknown>, title: string): boolean {
    if (!isKnownEarnedTitle(title)) return false;
    const legacy = character.legacy as { titles?: unknown } | undefined;
    const serverTitles = Array.isArray(character.serverTitles) ? character.serverTitles : [];
    const legacyTitles = Array.isArray(legacy?.titles) ? legacy.titles : [];
    const earnedTitles = Array.isArray(character.earnedTitles) ? character.earnedTitles : [];
    const ownershipSources = isServerCreditedTitle(title)
        ? [...serverTitles, ...legacyTitles]
        : [...earnedTitles, ...serverTitles, ...legacyTitles];
    return ownershipSources.some((owned) => typeof owned === 'string'
        && normalizeTitleKey(owned) === normalizeTitleKey(title));
}
