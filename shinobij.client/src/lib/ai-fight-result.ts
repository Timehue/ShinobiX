import type { Character } from '../types/character';

/** Follow the current accepted consequence, including a heal after settlement. */
export function aiFightExitScreen(hospitalized: boolean, returnScreen?: string): string | undefined {
    return hospitalized ? 'hospital' : returnScreen;
}

export function aiFightNonWinMessage(
    state: 'idle' | 'pending' | 'settled' | 'failed',
    character: Character | null | undefined,
    draw: boolean,
    /** A practice bout. Spars never hospitalize and never cost HP (server rule). */
    spar = false,
): string {
    if (state === 'failed') return 'The outcome could not be confirmed. Retry to finish saving your battle result.';
    if (state !== 'settled' || !character) return 'Confirming your battle result and recovery status…';
    if (character.hospitalized) return 'Your HP reached zero. You were brought to the hospital for treatment. No reward was earned.';
    if (spar) return `${draw ? 'The spar ended in a draw.' : 'You lost this spar.'} A spar never sends anyone to the hospital, so you keep your ${character.hp.toLocaleString()} HP.`;
    return `${draw ? 'Neither side could finish the fight.' : 'You left the fight.'} You have ${character.hp.toLocaleString()} HP remaining. No reward was earned.`;
}
