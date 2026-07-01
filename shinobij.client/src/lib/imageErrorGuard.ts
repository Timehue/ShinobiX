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

/*
 * Global image DECODE hint (install once, at app boot).
 *
 * None of the ~140 <img> sites set `decoding`, so the browser may decode large
 * decorative art (backdrops, banners, sector/coliseum scenes) on the MAIN THREAD
 * during a screen transition — a real source of hitches on weak phones. Rather
 * than annotate every site, a tiny MutationObserver stamps `decoding="async"` on
 * each <img> as it enters the DOM (and any already present). `async` is
 * universally safe: it never blocks, and at worst delays an image's first paint
 * by a frame. We deliberately do NOT force `loading="lazy"` globally — that can
 * reflow/flash above-the-fold art — so lazy-loading stays opt-in per site.
 */
function installImageDecodeHint(): void {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;
    const w = window as unknown as { __imgDecodeHintInstalled?: boolean };
    if (w.__imgDecodeHintInstalled) return;
    w.__imgDecodeHintInstalled = true;

    const hint = (img: HTMLImageElement) => { if (!img.hasAttribute("decoding")) img.decoding = "async"; };
    const scan = (node: Node) => {
        if (node instanceof HTMLImageElement) hint(node);
        else if (node instanceof Element && node.firstElementChild) node.querySelectorAll("img").forEach(hint);
    };

    document.querySelectorAll("img").forEach(hint); // any imgs already mounted at boot
    new MutationObserver((records) => {
        records.forEach((r) => r.addedNodes.forEach(scan));
    }).observe(document.documentElement, { childList: true, subtree: true });
}

installImageErrorGuard();
installImageDecodeHint();
