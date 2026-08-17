import { useCallback, useEffect, useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { accountKey } from "./player-accounts";
import type { PvpSessionState } from "../types/pvp-ui";
import type { PendingPvpRecovery, PvpRecoveryContext } from "./pvp-pending-session";
import { clearPvpSessionCreateIntent } from "./pvp-session-intent";

type PvpRole = "p1" | "p2";

export function usePvpSessionController(options: {
    characterName?: string;
    accountSessionEpoch: number;
    restoringSession: boolean;
    storageKey: string;
}): {
    pvpBattleId: string | null;
    setPvpBattleId: Dispatch<SetStateAction<string | null>>;
    pvpRole: PvpRole | null;
    setPvpRole: Dispatch<SetStateAction<PvpRole | null>>;
    pvpBattleContext: PvpRecoveryContext | null;
    setPvpBattleContext: Dispatch<SetStateAction<PvpRecoveryContext | null>>;
    pvpSeedSession: PvpSessionState | null;
    setPvpSeedSession: Dispatch<SetStateAction<PvpSessionState | null>>;
    pvpCompletionConfirmed: boolean;
    setPvpCompletionConfirmed: Dispatch<SetStateAction<boolean>>;
    installPvpRecovery: (pending: PendingPvpRecovery, scope?: { ownerName: string; accountSessionEpoch: number }) => void;
    installPvpBreadcrumb: (breadcrumb: { battleId: string; role?: PvpRole; context?: PvpRecoveryContext }, scope: { ownerName: string; accountSessionEpoch: number }) => void;
    clearPvpBattleState: () => void;
} {
    const ownerKey = accountKey(options.characterName ?? "");
    const ownerScopeKey = `${ownerKey}:${options.accountSessionEpoch}`;
    const [stateOwnerKey, setStateOwnerKey] = useState(ownerScopeKey);
    const [battleId, setBattleId] = useState<string | null>(null);
    const [pvpRole, setPvpRole] = useState<PvpRole | null>(null);
    const [pvpBattleContext, setPvpBattleContext] = useState<PvpRecoveryContext | null>(null);
    const [pvpSeedSession, setPvpSeedSession] = useState<PvpSessionState | null>(null);
    const [pvpCompletionConfirmed, setPvpCompletionConfirmed] = useState(false);
    const ownerScopeCurrent = stateOwnerKey === ownerScopeKey;
    const scopedBattleId = ownerScopeCurrent ? battleId : null;
    const scopedRole = ownerScopeCurrent ? pvpRole : null;
    const scopedContext = ownerScopeCurrent ? pvpBattleContext : null;
    const scopedSeed = ownerScopeCurrent ? pvpSeedSession : null;

    // Render the replacement account with no inherited PvP identity. Layout
    // cleanup retires the backing state before passive breadcrumb persistence.
    useLayoutEffect(() => {
        if (stateOwnerKey === ownerScopeKey) return;
        clearPvpSessionCreateIntent();
        setStateOwnerKey(ownerScopeKey);
        setBattleId(null);
        setPvpRole(null);
        setPvpBattleContext(null);
        setPvpSeedSession(null);
        setPvpCompletionConfirmed(false);
    }, [ownerScopeKey, stateOwnerKey]);

    // Reset completion synchronously in the same update that installs another
    // battle id. A passive-effect reset leaves one render where a completed old
    // battle can unlock navigation for the newly installed session.
    const setPvpBattleId: Dispatch<SetStateAction<string | null>> = useCallback((next) => {
        setStateOwnerKey(ownerScopeKey);
        setPvpCompletionConfirmed(false);
        setBattleId(next);
    }, [ownerScopeKey]);

    const clearPvpBattleState = useCallback(() => {
        clearPvpSessionCreateIntent();
        setStateOwnerKey(ownerScopeKey);
        setBattleId(null);
        setPvpRole(null);
        setPvpBattleContext(null);
        setPvpSeedSession(null);
        setPvpCompletionConfirmed(false);
    }, [ownerScopeKey]);

    const installPvpRecovery = useCallback((pending: PendingPvpRecovery, scope?: { ownerName: string; accountSessionEpoch: number }) => {
        const targetScope = scope
            ? `${accountKey(scope.ownerName)}:${scope.accountSessionEpoch}`
            : ownerScopeKey;
        setStateOwnerKey(targetScope);
        setPvpCompletionConfirmed(false);
        setBattleId(pending.battleId);
        setPvpRole(pending.role);
        setPvpBattleContext(pending.context);
        setPvpSeedSession(pending.session);
    }, [ownerScopeKey]);

    const installPvpBreadcrumb = useCallback((
        breadcrumb: { battleId: string; role?: PvpRole; context?: PvpRecoveryContext },
        scope: { ownerName: string; accountSessionEpoch: number },
    ) => {
        setStateOwnerKey(`${accountKey(scope.ownerName)}:${scope.accountSessionEpoch}`);
        setPvpCompletionConfirmed(false);
        setBattleId(breadcrumb.battleId);
        setPvpRole(breadcrumb.role ?? null);
        setPvpBattleContext(breadcrumb.context ?? null);
        setPvpSeedSession(null);
    }, []);

    useEffect(() => {
        try {
            // The boot loader consumes this key asynchronously. Do not let the
            // initial null state erase it before restore has had a chance.
            if (options.restoringSession && !scopedBattleId) return;
            if (scopedBattleId && options.characterName) {
                localStorage.setItem(options.storageKey, JSON.stringify({
                    owner: ownerKey,
                    pvpBattleId: scopedBattleId,
                    pvpRole: scopedRole,
                    pvpBattleContext: scopedContext,
                    savedAt: Date.now(),
                }));
            } else {
                localStorage.removeItem(options.storageKey);
            }
        } catch { /* quota, private mode, or SSR */ }
    }, [
        scopedBattleId,
        scopedRole,
        scopedContext,
        ownerKey,
        options.restoringSession,
        options.characterName,
        options.storageKey,
    ]);

    return {
        pvpBattleId: scopedBattleId,
        setPvpBattleId,
        pvpRole: scopedRole,
        setPvpRole,
        pvpBattleContext: scopedContext,
        setPvpBattleContext,
        pvpSeedSession: scopedSeed,
        setPvpSeedSession,
        pvpCompletionConfirmed: ownerScopeCurrent && pvpCompletionConfirmed,
        setPvpCompletionConfirmed,
        installPvpRecovery,
        installPvpBreadcrumb,
        clearPvpBattleState,
    };
}
