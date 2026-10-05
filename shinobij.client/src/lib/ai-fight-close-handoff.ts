export type AiFightCloseHandoff = {
    playerKey: string;
    requestId: number;
    returnScreen?: string;
};

export type AiFightCloseNavigation = {
    playerKey: string;
    generation: number;
    returnScreen?: string;
    isCurrent: () => boolean;
};

/** Suppress duplicate closes without carrying a completed request's lock forward. */
export function beginAiFightClose(closingRequest: { current: number | null }, requestId: number): boolean {
    if (closingRequest.current === requestId) return false;
    closingRequest.current = requestId;
    return true;
}

/** A new fight/account cancels an old return; guard updates merely delay it. */
export function aiFightCloseNavigationState(
    pending: AiFightCloseNavigation,
    scope: { playerKey: string; generation: number; sealedFightOpen: boolean; missionBattleActive: boolean },
): 'discard' | 'wait' | 'ready' {
    if (scope.playerKey !== pending.playerKey || scope.generation !== pending.generation || !pending.isCurrent()) return 'discard';
    return scope.sealedFightOpen || scope.missionBattleActive ? 'wait' : 'ready';
}

/** Retire a close only after the portal's closed render commits. */
export function consumeCommittedAiFightClose<T extends AiFightCloseHandoff>(
    pending: { current: T | null },
    scope: { open: boolean; playerKey: string; requestId: number },
): T | null {
    const close = pending.current;
    if (!close) return null;
    if (close.playerKey !== scope.playerKey || close.requestId !== scope.requestId) {
        pending.current = null;
        return null;
    }
    if (scope.open) return null;
    pending.current = null;
    return close;
}
