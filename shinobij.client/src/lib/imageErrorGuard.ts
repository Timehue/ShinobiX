/*
 * Global image load-error guard (install once, at app boot).
 *
 * The game renders dozens of remote images per screen — item/jutsu thumbnails,
 * portraits, sector art, badges — and they all come from a single image host
 * (theravensark.com / cPanel) that has gone down before. Without handling, a
 * host hiccup fills every screen with the browser's broken-image icon.
 *
 * Rather than add onError to ~80 <img> sites across the 34k-line App.tsx, this
 * installs ONE capture-phase listener on window. Resource 'error' events (img,
 * script, link) do NOT bubble, but they DO reach window in the CAPTURE phase, so
 * a single listener with `capture: true` sees every image that fails to load.
 * It hides the broken <img> (no broken-icon spread); images that already have
 * their own onError keep working (both fire — hiding is idempotent).
 *
 * It deliberately does nothing for non-image targets (script/stylesheet errors
 * and runtime JS errors), so chunk-load failures still reach the ErrorBoundary
 * and other error handling is untouched.
 */
function installImageErrorGuard(): void {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __imgErrorGuardInstalled?: boolean };
    if (w.__imgErrorGuardInstalled) return;
    w.__imgErrorGuardInstalled = true;

    window.addEventListener(
        "error",
        (e: Event) => {
            const t = e.target;
            if (t instanceof HTMLImageElement && t.dataset.imgFailed !== "1") {
                t.dataset.imgFailed = "1";
                // Collapse the broken image (matches the per-component onError
                // handlers that already use display:none). No broken-icon, no
                // alt-text fallback box — just absent, app-wide.
                t.style.display = "none";
            }
        },
        true, // capture: resource 'error' events don't bubble to window otherwise
    );
}

installImageErrorGuard();
