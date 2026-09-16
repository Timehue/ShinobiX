import { useEffect, useRef, type ReactNode } from 'react';
import './stronghold.css';

/** Native modal supplies focus containment, focus restoration and inert background. */
export function StrongholdDialog({ title, children, onClose, busy = false }: {
    title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current!;
        element.showModal();
        return () => element.close();
    }, []);
    // Dismiss only this view. Its parent still owns any submitted action and
    // must reconcile the response even after the dialog is gone.
    return <dialog ref={dialog} className="stronghold-dialog" aria-label={title} aria-busy={busy}
        onCancel={event => { event.preventDefault(); onClose(); }}
        onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="stronghold-dialog-content">
            <div className="stronghold-dialog-heading"><h2>{title}</h2><button aria-label="Close dialog" onClick={onClose}>×</button></div>
            {children}
        </div>
    </dialog>;
}
