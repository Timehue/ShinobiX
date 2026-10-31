import type { BattleHistoryEntry, Character } from '../types/character';
import type { AiFightSettleResult } from './ai-fight-settle';
import { soloPveLeftByChoice, type SoloPveTerminalReason } from '../../../shared/solo-pve-terminal';

/** Only a confirmed receipt determines amounts; zero ryo alone does not imply practice. */
export function aiFightWinRewardText(result: AiFightSettleResult, spar: boolean, worldEncounter: boolean): string {
    if (!result.settled) return 'No reward was granted for this fight.';
    if (result.replayed) return 'This reward was already collected.';
    const rewards = [
        result.ryo > 0 ? `+${result.ryo.toLocaleString()} ryo` : '',
        result.statPoints > 0 ? `+${result.statPoints} stat points` : '',
    ].filter(Boolean);
    const limit = result.capped ? result.ryo > 0
        ? ' The daily ryo limit reduced this payout.'
        : ' The daily ryo limit prevented a ryo payout.' : '';
    // The shared daily stat-point budget, so a win that paid no stat points says why.
    if (result.statBudget && !spar) rewards.push(`Stat points today: ${Math.min(result.statBudget.spent, result.statBudget.cap)} / ${result.statBudget.cap}`);
    if (rewards.length) return rewards.join(' · ') + limit;
    if (spar) return 'Practice bout — no rewards.';
    return `No direct ryo or stat points were awarded for this ${worldEncounter ? 'encounter' : 'fight'}.` + limit;
}

/** Follow the current accepted consequence, including a heal after settlement. */
export function aiFightExitScreen(hospitalized: boolean, returnScreen?: string): string | undefined {
    return hospitalized ? 'hospital' : returnScreen;
}

/**
 * The record of a fled fight says the enemy won, because no reward may pay out.
 * Result screens read this instead, so leaving is never shown as a knockout. An
 * escape can still spend the last of the player's HP; that one was a real defeat.
 */
export function aiFightLeftLabel(reason: SoloPveTerminalReason | undefined, knockedOut?: boolean): 'Escaped' | 'Retreated' | 'Fight expired' | null {
    if (knockedOut) return null;
    if (reason === 'escaped') return 'Escaped';
    if (reason === 'abandoned') return 'Retreated';
    return reason === 'lapsed' ? 'Fight expired' : null;
}

/** World Map aftermath lines: a player who left was not overwhelmed by anyone. */
export function aiFightBrokeAway(
    settlement: { outcome: string | null; terminalReason?: SoloPveTerminalReason; character?: Character | null },
): boolean {
    if (settlement.outcome === 'win' || settlement.outcome === 'draw' || settlement.character?.hospitalized) return false;
    return settlement.outcome === 'forfeit' || soloPveLeftByChoice(settlement.terminalReason);
}

export function aiFightHistoryOutcome(winner: string | null | undefined, reason: SoloPveTerminalReason | undefined): BattleHistoryEntry['outcome'] {
    if (winner === 'squad') return 'win';
    if (winner === 'draw') return 'draw';
    return soloPveLeftByChoice(reason) ? 'flee' : 'loss';
}

export function aiFightNonWinMessage(
    state: 'idle' | 'pending' | 'settled' | 'failed',
    character: Character | null | undefined,
    draw: boolean,
    /** A practice bout. Spars never hospitalize and never cost HP (server rule). */
    spar = false,
    reason?: SoloPveTerminalReason,
): string {
    if (state === 'failed') return 'The outcome could not be confirmed. Retry to finish saving your battle result.';
    if (state !== 'settled' || !character) return 'Confirming your battle result and recovery status…';
    if (character.hospitalized) return `${!draw && reason === 'escaped' ? 'You got away, but the escape took your last HP.' : 'Your HP reached zero.'} You were brought to the hospital for treatment. No reward was earned.`;
    if (!draw && reason === 'escaped') return spar
        ? `You left this spar. A spar never sends anyone to the hospital, so you keep your ${character.hp.toLocaleString()} HP.`
        : `You escaped with ${character.hp.toLocaleString()} HP. No reward was earned.`;
    if (!draw && reason === 'abandoned') return `You left the fight with ${character.hp.toLocaleString()} HP. No reward was earned.`;
    if (spar) return `${draw ? 'The spar ended in a draw.' : 'You lost this spar.'} A spar never sends anyone to the hospital, so you keep your ${character.hp.toLocaleString()} HP.`;
    return `${draw ? 'The fight ended in a draw.' : 'You did not win this fight.'} You have ${character.hp.toLocaleString()} HP remaining. No reward was earned.`;
}
