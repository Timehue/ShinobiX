import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';

/** Keep the course and touch controls together, outside the town's scrolling shell. */
export function RallySession({ children }: { children: ReactNode }) {
    const root = useRef<HTMLDivElement>(null);
    useBodyScrollLock(true);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        root.current?.focus({ preventScroll: true });
        return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    }, []);
    return createPortal(<div ref={root} className="sunscar-mode sunscar-rally sunscar-rally-session"
        role="dialog" aria-modal="true" aria-label="Pet Rally race" tabIndex={-1}
        onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')]
                .filter(element => element.getClientRects().length > 0);
            const first = buttons[0], last = buttons.at(-1);
            if (!first || !last) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
                event.preventDefault(); first.focus();
            }
        }}>{children}</div>, document.body);
}
