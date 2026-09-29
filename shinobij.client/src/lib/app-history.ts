import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Screen } from '../types/core';
import { RETURN_SCREENS } from './navigation-trail';
import { isPlayApp } from './surface';

export type BackDecision =
    | { action: 'refuse'; reason: 'battle-unresolved' | 'unknown-target' }
    | { action: 'navigate'; screen: Screen; fellBack?: true };

/** Where back lands when the popped entry is not safe to restore and the caller */
/** did not say where the player is. The App passes the player's LOCATION instead */
/** (worldMap in a wild sector), like the refresh path and the in-app goBack do: */
/** a hardcoded village teleported a player out of the world on a back press. */
const BACK_FALLBACK_SCREEN: Screen = 'village';

/** `#/village` → `village`. Anything else yields an empty string. */
export function screenFromHash(hash: string): string {
    const raw = String(hash ?? '');
    return raw.startsWith('#/') ? raw.slice(2) : '';
}

export function hashForScreen(screen: Screen): string {
    return `#/${screen}`;
}

/**
 * Pure core: what should a back press do? Exported so the refusal rules are
 * testable without a browser or a React tree.
 */
export function decideBack(opts: {
    targetHash: string;
    battleUnresolved: boolean;
    /** Where the player IS (safeFallbackScreen). Defaults to the village. */
    fallbackScreen?: Screen;
}): BackDecision {
    // Checked FIRST and unconditionally: no target is worth leaving a live fight
    // for, so this cannot be reordered below the target checks.
    if (opts.battleUnresolved) return { action: 'refuse', reason: 'battle-unresolved' };

    const target = screenFromHash(opts.targetHash);
    // A hash we never wrote — we have popped past our own entries. Refusing
    // re-pushes and keeps the app alive rather than showing a foreign URL.
    if (!target) return { action: 'refuse', reason: 'unknown-target' };

    // Not safe to land on (battle/encounter screens hold ephemeral state or a
    // sealed session). Fall back rather than refuse: these entries are the
    // COMMON case, not the rare one — finishing any fight leaves one behind, so
    // village → petArena → village is an ordinary stack. Refusing there would
    // make back silently do nothing, which reads as a broken button.
    if (!RETURN_SCREENS.has(target as Screen)) {
        return { action: 'navigate', screen: opts.fallbackScreen ?? BACK_FALLBACK_SCREEN, fellBack: true };
    }
    return { action: 'navigate', screen: target as Screen };
}

/** Browser and Android Back follow the same guarded screen journey. Browser
 * entries contain navigation only, never combat state or authority. */
export function useAppHistory(
    screen: Screen,
    navigate: (next: Screen) => boolean | void,
    isNavigationBlocked: () => boolean,
    fallbackScreen?: () => Screen,
    account = '',
): void {
    const latest = useRef({ screen, navigate, isNavigationBlocked, fallbackScreen, account });
    useLayoutEffect(() => { latest.current = { screen, navigate, isNavigationBlocked, fallbackScreen, account }; });
    const stack = useRef<Screen[]>([]);
    const owner = useRef(account);
    const restoringEntry = useRef(false);
    const popped = useRef(false);

    useEffect(() => {
        if (screen === 'start' || owner.current !== account) {
            stack.current = [];
            owner.current = account;
        }
        // Preserve a bookmark while the account is loading.
        if (screen === 'start') return;
        try {
            const write = (method: 'pushState' | 'replaceState') => window.history[method](
                { shinobiNavigation: { account, stack: stack.current } }, '', hashForScreen(screen));
            if (popped.current) {
                popped.current = false;
                write('replaceState');
                return;
            }
            if (!stack.current.length) {
                const saved = window.history.state?.shinobiNavigation;
                stack.current = saved?.account === account && Array.isArray(saved.stack)
                    && saved.stack.at(-1) === screen ? saved.stack : [screen];
                write('replaceState');
                return;
            }
            const index = stack.current.lastIndexOf(screen);
            if (index === stack.current.length - 1) return;
            if (index >= 0) {
                const distance = index - stack.current.length + 1;
                stack.current = stack.current.slice(0, index + 1);
                restoringEntry.current = true;
                window.history.go(distance);
                return;
            }
            // Retire a one-use encounter entry as soon as it is left. Forward
            // must not resurrect a completed fight or a profile with no id.
            const replace = !RETURN_SCREENS.has(stack.current.at(-1)!);
            stack.current = [...(replace ? stack.current.slice(0, -1) : stack.current), screen];
            write(replace ? 'replaceState' : 'pushState');
        } catch { /* storage/history restricted */ }
    }, [screen, account]);

    useEffect(() => {
        const onPopState = () => {
            const current = latest.current;
            const entry = window.history.state?.shinobiNavigation;
            const writeCurrent = () => window.history.replaceState(
                { shinobiNavigation: { account: current.account, stack: stack.current } }, '', hashForScreen(current.screen));
            if (restoringEntry.current) {
                restoringEntry.current = false;
                writeCurrent();
                return;
            }
            // A normal website must let Back leave the app's own history.
            if (!entry && !isPlayApp()) return;
            const decision = decideBack({
                targetHash: entry?.account === current.account ? window.location.hash : '',
                battleUnresolved: current.isNavigationBlocked(),
                fallbackScreen: current.fallbackScreen?.(),
            });
            if (decision.action === 'navigate') {
                if (current.navigate(decision.screen) !== false) {
                    const entries: Screen[] = Array.isArray(entry?.stack) ? entry.stack : [decision.screen];
                    stack.current = [...entries.slice(0, -1), decision.screen];
                    popped.current = decision.screen !== current.screen;
                    window.history.replaceState({ shinobiNavigation: { account: current.account, stack: stack.current } }, '', hashForScreen(decision.screen));
                    return;
                }
            }
            const distance = stack.current.length - (Array.isArray(entry?.stack) ? entry.stack.length : 0);
            if (distance) {
                restoringEntry.current = true;
                window.history.go(distance);
            } else writeCurrent();
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);
}
