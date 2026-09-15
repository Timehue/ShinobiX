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
    return <dialog ref={dialog} className="stronghold-dialog" aria-label={title}
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
        onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <div className="stronghold-dialog-content">
            <div className="stronghold-dialog-heading"><h2>{title}</h2><button aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>
            {children}
        </div>
    </dialog>;
}
