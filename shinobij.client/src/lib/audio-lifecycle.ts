// Visibility and page-cache navigation are separate browser lifecycle signals.
// Keep them separate from the player's persisted mute preference.
let pageHidden = false;
let installed = false;
const listeners = new Set<() => void>();

export function isAudioBackgrounded(): boolean {
    return pageHidden || (typeof document !== "undefined" && document.hidden);
}

function notify(): void {
    for (const listener of listeners) {
        try { listener(); } catch { /* Audio must not interrupt navigation. */ }
    }
}

function onPageHide(): void { pageHidden = true; notify(); }
function onPageShow(): void { pageHidden = false; notify(); }

export function subscribeAudioLifecycle(listener: () => void): () => void {
    if (!installed && typeof document !== "undefined" && typeof window !== "undefined") {
        installed = true;
        document.addEventListener("visibilitychange", notify);
        window.addEventListener("pagehide", onPageHide);
        window.addEventListener("pageshow", onPageShow);
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (installed && listeners.size === 0) {
            document.removeEventListener("visibilitychange", notify);
            window.removeEventListener("pagehide", onPageHide);
            window.removeEventListener("pageshow", onPageShow);
            installed = false;
        }
    };
}
