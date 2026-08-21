/*
 * Reset transient "navigating away…" UI after a bfcache restore.
 *
 * Flows that hand the browser to another origin (Google sign-in) leave a
 * busy/status flag set while the page navigates away — correct in the moment,
 * but pressing Back from the other origin can restore the page FROM BFCACHE
 * with that state intact, freezing the controls with nothing in flight. A
 * bfcache restore announces itself via `pageshow` with `persisted: true`;
 * this hook runs the given reset there.
 *
 * Used by the login gate, the Google link card, and the guest social lock —
 * every surface that hands the browser to Google and can be returned to.
 */
import { useEffect, useRef } from "react";

export function useBfcacheRestore(onRestore: () => void) {
    const callbackRef = useRef(onRestore);
    useEffect(() => {
        callbackRef.current = onRestore;
    }, [onRestore]);
    useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) callbackRef.current();
        };
        window.addEventListener("pageshow", onPageShow);
        return () => window.removeEventListener("pageshow", onPageShow);
    }, []);
}
