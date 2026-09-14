import type { Character } from '../types/character';

/** Follow the current accepted consequence, including a heal after settlement. */
export function aiFightExitScreen(hospitalized: boolean, returnScreen?: string): string | undefined {
    return hospitalized ? 'hospital' : returnScreen;
}

export function aiFightNonWinMessage(
    state: 'idle' | 'pending' | 'settled' | 'failed',
    character: Character | null | undefined,
    draw: boolean,
): string {
    if (state === 'failed') return 'The outcome could not be confirmed. Retry to finish saving your battle result.';
    if (state !== 'settled' || !character) return 'Confirming your battle result and recovery status…';
    if (character.hospitalized) return 'Your HP reached zero. You were brought to the hospital for treatment. No reward was earned.';
    return `${draw ? 'Neither side could finish the fight.' : 'You left the fight.'} You have ${character.hp.toLocaleString()} HP remaining. No reward was earned.`;
}
