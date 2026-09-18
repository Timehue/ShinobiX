import type { Character } from '../types/character';

/** A local receipt proves selection; a pending report is not a permanent acknowledgement. */
export function storyChoiceStatus(character: Pick<Character, 'pendingStoryReports' | 'storyChoices'>, eventId: string): string {
    const report = character.pendingStoryReports?.find(row => row.eventId === eventId);
    if (report?.status === 'conflict') return 'Choice differs from the permanent Chronicle record. See Story Hall.';
    if (report) return 'Choice selected. Permanent Chronicle record pending; retrying automatically.';
    if (character.storyChoices?.some(row => row.eventId === eventId)) return 'Choice preserved in your story history.';
    return 'Scene complete.';
}
