/** Server-owned explanation, separate from winner/outcome and HP settlement. */
export type SoloPveTerminalReason = 'knockout' | 'round-limit' | 'escaped' | 'abandoned' | 'survived' | 'lapsed';

/** The player chose to leave. The record says the enemy won, but nobody beat them. */
export function soloPveLeftByChoice(reason: SoloPveTerminalReason | undefined): boolean {
    return reason === 'escaped' || reason === 'abandoned';
}
