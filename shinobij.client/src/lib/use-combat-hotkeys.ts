import { createContext, useLayoutEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import { COMBAT_ACTIONS, DEFAULT_COMBAT_BINDINGS, keyFromEvent, readCombatBindings, type CombatBindings } from './combat-hotkeys';

export const CombatBindingsContext = createContext(DEFAULT_COMBAT_BINDINGS);
const serverSnapshot = JSON.stringify(DEFAULT_COMBAT_BINDINGS);
function subscribeBindings(refresh: () => void) {
    window.addEventListener('combat-hotkeys-change', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('combat-hotkeys-change', refresh); window.removeEventListener('storage', refresh); };
}
export function useCombatBindings(player: string): CombatBindings {
    // Serialize the small validated record so unchanged snapshots retain identity.
    const snapshot = useSyncExternalStore(subscribeBindings, () => JSON.stringify(readCombatBindings(player)), () => serverSnapshot);
    return useMemo(() => JSON.parse(snapshot) as CombatBindings, [snapshot]);
}
export function useCombatHotkeys(root: RefObject<HTMLDivElement | null>, player: string, active: boolean, onDeselect?: () => void) {
    const bindings = useCombatBindings(player);
    // Match committed enabled controls before the browser can deliver the next key.
    useLayoutEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (!active || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : document.activeElement;
            if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            if (Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')).some(dialog => dialog.getClientRects().length > 0)) return;
            const key = keyFromEvent(event);
            const action = key && COMBAT_ACTIONS.find(({ id }) => bindings[id] === key)?.id;
            if (!action) return;
            if ((key === 'space' || key === 'enter') && target?.closest('button, [role="button"]')) return;
            if (action === 'deselect') { if (onDeselect) { event.preventDefault(); onDeselect(); } return; }
            const button = root.current?.querySelector<HTMLButtonElement>(`button[data-combat-action="${action}"]`);
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
            event.preventDefault(); button.click();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [root, active, onDeselect, bindings]);
    return bindings;
}
