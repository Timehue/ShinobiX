import { useEffect, type RefObject } from 'react';

/** Native encounters yield to the application's global confirmation and
 * reauthentication portals, then reopen with their controlled state intact. */
export function usePriorityNativeModal(ref: RefObject<HTMLDialogElement | null>) {
    useEffect(() => {
        const element = ref.current!;
        const reconcile = () => {
            const reauth = document.querySelector<HTMLElement>('[aria-labelledby="session-expired-title"]');
            const alert = [...document.querySelectorAll<HTMLElement>('[role="alertdialog"][aria-modal="true"]')].filter(node => node.getClientRects().length > 0).at(-1);
            const higher = reauth ?? alert;
            if (higher) {
                if (element.open) {
                    element.close();
                    if (!higher.contains(document.activeElement)) (higher.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]') ?? higher).focus();
                }
            } else if (element.isConnected && !element.open) element.showModal();
        };
        const observer = new MutationObserver(reconcile);
        observer.observe(document.body, { childList: true, subtree: true });
        reconcile();
        return () => { observer.disconnect(); if (element.open) element.close(); };
    }, [ref]);
}
