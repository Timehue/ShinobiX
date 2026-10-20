import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Screen } from '../types/core';
import { warmHollowGateGenerator } from './hollow-gate-generator-loader';
import { loadHollowGateShrineView } from './hollow-gate-app-flow';

/** A preview belongs to one map visit. Interruption cancels, never confirms it. */
export function useHollowGateEntryPreview(screen: Screen, account: string | undefined, combatActive: boolean, isCombatActive?: () => boolean) {
    const request = useRef<AbortController | null>(null);
    const encounterActive = useRef(false);
    const cancel = useCallback(() => { request.current?.abort(); request.current = null; }, []);

    useLayoutEffect(() => cancel, [screen, account, cancel]);
    useLayoutEffect(() => { if (combatActive) cancel(); }, [combatActive, cancel]);

    const onEncounterActiveChange = useCallback((active: boolean) => {
        encounterActive.current = active;
        if (active) cancel();
    }, [cancel]);

    const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
        if (screen !== 'worldMap' || !account || combatActive || isCombatActive?.() || encounterActive.current || request.current) return;
        const controller = new AbortController();
        request.current = controller;
        void loadHollowGateShrineView().catch(() => undefined);
        warmHollowGateGenerator();
        try { await operation(controller.signal); }
        finally { if (request.current === controller) request.current = null; }
    };
    return { run, onEncounterActiveChange };
}
