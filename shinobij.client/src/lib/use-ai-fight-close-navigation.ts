import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Screen } from '../types/core';
import { playerSlug } from './utils';
import { aiFightCloseNavigationState, type AiFightCloseNavigation } from './ai-fight-close-handoff';

/** The host's closed commit precedes the App mission guard's closed commit. */
export function useAiFightCloseNavigation({
    account, sealedFightOpen, missionBattleActive, setMissionBattleActive, navigate,
}: {
    account: string;
    sealedFightOpen: boolean;
    missionBattleActive: boolean;
    setMissionBattleActive: (active: boolean) => void;
    navigate: (screen: Screen) => void;
}) {
    const [pending, setPending] = useState<AiFightCloseNavigation | null>(null);
    const owner = useRef({ playerKey: playerSlug(account), generation: 0 });
    const navigateRef = useRef(navigate);
    useLayoutEffect(() => {
        const playerKey = playerSlug(account);
        if (owner.current.playerKey !== playerKey) {
            owner.current = { playerKey, generation: owner.current.generation + 1 };
        }
        navigateRef.current = navigate;
    });
    const onClose = useCallback((returnScreen: string | undefined, playerKey: string, isCurrent: () => boolean) => {
        if (owner.current.playerKey !== playerKey) return;
        setMissionBattleActive(false);
        setPending({ playerKey, generation: owner.current.generation, returnScreen, isCurrent });
    }, [setMissionBattleActive]);
    const consumed = useRef<AiFightCloseNavigation | null>(null);
    const stableNavigate = useCallback((screen: Screen) => navigateRef.current(screen), []);
    useEffect(() => {
        if (!pending || consumed.current === pending) return;
        const state = aiFightCloseNavigationState(pending, { ...owner.current, sealedFightOpen, missionBattleActive });
        if (state === 'wait') return;
        consumed.current = pending;
        if (state === 'discard') return;
        // Use the ordinary navigation function after its guard signals commit.
        // Other live battles, travel, and hospital restrictions still apply.
        if (pending.returnScreen) navigateRef.current(pending.returnScreen as Screen);
    }, [pending, sealedFightOpen, missionBattleActive, account]);
    return { onClose, stableNavigate };
}
