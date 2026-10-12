import { useRef, type ReactNode, type CSSProperties } from 'react';
import { usePriorityNativeModal } from '../../lib/use-priority-native-modal';

/** Native modal keeps keyboard focus and background input inside the encounter. */
export function HollowGateEventDialog({ titleId, busy, onDismiss, children, className, style, descriptionId, mode }: { titleId: string; busy?: boolean; onDismiss?: () => void; children: ReactNode; className?: string; style?: CSSProperties; descriptionId?: string; mode?: string }) {
    const ref = useRef<HTMLDialogElement>(null);
    usePriorityNativeModal(ref);
    return <dialog ref={ref} className={`hg-event-dialog ${className ?? ''}`} style={style} data-mode={mode} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1}
        onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length > 0);
            const first = controls[0], last = controls.at(-1), active = document.activeElement;
            if (!first) { event.preventDefault(); ref.current?.focus(); }
            else if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) { event.preventDefault(); first.focus(); }
        }}
        onCancel={event => { event.preventDefault(); if (!busy) onDismiss?.(); }}>{children}</dialog>;
}
