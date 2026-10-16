/** Account-scoped UI readiness only; this never mutates a server encounter. */
export type AiFightRecoveryPresence = { playerKey: string; completedScope: string };

export function aiFightRecoveryOwner(state: AiFightRecoveryPresence, playerKey: string): AiFightRecoveryPresence {
    return state.playerKey === playerKey ? state : { playerKey, completedScope: '' };
}

export function aiFightRecoveryPending(state: AiFightRecoveryPresence, playerKey: string, scope: string): boolean {
    return !!scope && (state.playerKey !== playerKey || state.completedScope !== scope);
}

export function completeAiFightRecovery(state: AiFightRecoveryPresence, playerKey: string, scope: string): AiFightRecoveryPresence {
    return state.playerKey === playerKey ? { playerKey, completedScope: scope } : state;
}

export function aiFightRecoveryIsCurrent(
    mounted: boolean, playerKey: string, requestId: number, currentPlayerKey: string, currentRequestId: number,
): boolean {
    return mounted && playerKey === currentPlayerKey && requestId === currentRequestId;
}
