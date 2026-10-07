/** Bridge the road seam with one marker while the camera changes floors. */
export function panSectorAvatar(wrap: HTMLElement, figure: HTMLElement) {
    if (!wrap.animate || document.documentElement.classList.contains('lite-fx')
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const before = new DOMMatrix(getComputedStyle(figure).transform);
    let cancelled = false;
    let animation: Animation | undefined;
    // The subsequent layout effect places the figure at the authoritative arrival.
    // Before paint, offset it back to the old road mouth, then follow the same
    // easing as the floor. Interpolating these screen positions also advances the
    // player across the seam in world space without duplicating their portrait.
    queueMicrotask(() => {
        if (cancelled || !wrap.isConnected) return;
        const after = new DOMMatrix(getComputedStyle(figure).transform);
        animation = wrap.animate([
            { transform: `translate(${before.m41 - after.m41}px,${before.m42 - after.m42}px)` },
            { transform: 'translate(0,0)' },
        ], { duration: 420, easing: 'cubic-bezier(.22,.61,.36,1)' });
    });
    return () => { cancelled = true; animation?.cancel(); };
}
