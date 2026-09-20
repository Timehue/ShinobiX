import { useCallback, useLayoutEffect, useRef } from 'react';

/** Touch browsers disagree on whether a prevented pointer gesture emits click.
 * Keep its click lease in the HUD owner after the popover closes. The first
 * compatibility click is consumed; a fresh pointer/keyboard gesture retires the
 * lease first. No timeout, permanent blocker, or surviving unmount listener. */
export function useDismissGesture() {
    const release = useRef<(() => void) | null>(null);
    useLayoutEffect(() => () => release.current?.(), []);
    return useCallback(() => {
        release.current?.();
        const clear = () => {
            document.removeEventListener('click', click, true);
            document.removeEventListener('pointerdown', clear, true);
            document.removeEventListener('keydown', clear, true);
            release.current = null;
        };
        const click = (event: MouseEvent) => {
            event.preventDefault(); event.stopImmediatePropagation(); clear();
        };
        release.current = clear;
        document.addEventListener('click', click, true);
        document.addEventListener('pointerdown', clear, true);
        document.addEventListener('keydown', clear, true);
    }, []);
}
