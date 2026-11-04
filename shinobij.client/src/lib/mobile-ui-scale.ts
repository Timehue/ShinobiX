/*
 * mobile-ui-scale — draws menus 15% smaller on portrait Android/Chromium
 * phones, so more of each screen fits without scrolling. WebKit (every iOS
 * browser) is excluded for now; see isWebKitOnlyBrowser.
 *
 * It works through the viewport <meta>: `initial-scale=0.85` widens the layout
 * viewport (390 CSS px → ~459) and the browser draws it back at the phone's
 * width. CSS `zoom` was tried first and rejected: under zoom, Chromium shrinks
 * vh/dvh with everything else, so every `100dvh` shell would end 15% short.
 * The viewport route keeps viewport units, fixed overlays, canvases and touch
 * coordinates consistent, because the browser itself owns the scaling.
 *
 * index.html ships the phone viewport and public/boot-watchdog.js resets every
 * other device to 1.0 before the first layout, so a phone never loads through
 * a 1.0 viewport (with one, Chrome could restore 1.0 after a reload). This
 * module owns the rule once it runs.
 *
 * Combat, the card game and the world map keep their tuned full-size layouts
 * (the map has its own zoom, and its canvas outgrew the bottom nav). Their root
 * components call `useFullScaleViewport()` (or `holdFullScaleViewport()`) while
 * mounted, and any active hold restores `initial-scale=1`.
 */
import { useLayoutEffect } from "react";

export const MOBILE_UI_SCALE = 0.85;

/**
 * Phones only. Kept low enough that the widened layout (470 / 0.85 = 553) stays
 * under the 560px `sm` breakpoint, so a scaled phone never leaves the phone shell.
 */
export const PHONE_MAX_SHORT_SIDE = 470;

export const BASE_VIEWPORT_CONTENT = "width=device-width, initial-scale=1.0, viewport-fit=cover";

export interface ViewportScaleInputs {
    /** A touch-primary phone held in portrait, on a browser this is proven on. */
    portraitPhone: boolean;
    /** Combat, card-game or world-map UI is mounted. */
    fullScaleHeld: boolean;
}

export function viewportScaleFor(inputs: ViewportScaleInputs): number {
    return inputs.portraitPhone && !inputs.fullScaleHeld ? MOBILE_UI_SCALE : 1;
}

export function viewportContentFor(inputs: ViewportScaleInputs): string {
    const scale = viewportScaleFor(inputs);
    if (scale === 1) return BASE_VIEWPORT_CONTENT;
    // minimum-scale pins the layout width at device-width / scale. Without it,
    // Chrome zooms out to fit anything that overflows sideways (an off-screen
    // drawer is enough) and the phone falls into the ~960px desktop layout.
    return `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, viewport-fit=cover`;
}

let holds = 0;
let installed = false;
let currentScale = 1;
let zoomReset: { baseContent: string; content: string } | null = null;

/** The page scale the viewport meta currently asks for (1 or MOBILE_UI_SCALE). */
export function currentViewportBaseScale(): number {
    return currentScale;
}

/**
 * Every iOS browser, and Safari anywhere, runs WebKit. Its page scale leaves
 * 48px targets measuring 47.99, misplaces taps in the e2e harness, and is
 * unverified on a real iPhone (input auto-zoom, restoring 1.0 for a fight), so
 * WebKit keeps the shipped viewport until it is proven on a device.
 */
export function isWebKitOnlyBrowser(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
    if (/iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)) return true;
    return /AppleWebKit/.test(userAgent) && !/(Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(userAgent);
}

function isPortraitPhone(): boolean {
    try {
        if (isWebKitOnlyBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) return false;
        if (!window.matchMedia("(pointer: coarse)").matches) return false;
        const shortSide = Math.min(window.screen.width, window.screen.height);
        if (!shortSide || shortSide > PHONE_MAX_SHORT_SIDE) return false;
        // Screen orientation, not viewport aspect: an open keyboard shortens the
        // viewport and must not flip the scale mid-typing.
        const type = window.screen.orientation?.type;
        if (type) return type.startsWith("portrait");
        return window.screen.height >= window.screen.width;
    } catch {
        return false;
    }
}

function apply(): void {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const inputs = { portraitPhone: isPortraitPhone(), fullScaleHeld: holds > 0 };
    currentScale = viewportScaleFor(inputs);
    const content = viewportContentFor(inputs);
    // A full-scale hold or device change cancels an obsolete history reset.
    if (zoomReset && zoomReset.baseContent !== content) zoomReset = null;
    const desired = zoomReset?.content ?? content;
    if (meta.getAttribute("content") !== desired) meta.setAttribute("content", desired);
}

/** How long after load a scale jump counts as Chrome restoring a zoom. */
const HISTORY_RESTORE_WINDOW_MS = 2_000;

/**
 * Chrome restores a page's saved zoom from history just after `load` (seen as
 * a 0.85 -> 1.0 jump at readyState "complete" on reload). At 1.0 the 458px
 * phone layout overflows the screen and taps land on the wrong control. A
 * Changing maximum-scale alone does not make Chrome recompute its restored
 * zoom. Briefly change initial-scale too, then restore the base after a paint.
 * Release the temporary cap after another paint so pinch-zoom keeps working.
 */
function snapToBaseScale(): void {
    const viewport = window.visualViewport;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport || !meta || zoomReset || currentScale === 1 || Math.abs(viewport.scale - currentScale) < 0.02) return;
    const baseContent = viewportContentFor({ portraitPhone: true, fullScaleHeld: false });
    const kickScale = currentScale + 0.01;
    const reset = { baseContent, content: `${baseContent.replace(`initial-scale=${currentScale}`, `initial-scale=${kickScale}`)}, maximum-scale=${kickScale}` };
    zoomReset = reset;
    meta.setAttribute("content", reset.content);
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (zoomReset !== reset) return;
        reset.content = `${baseContent}, maximum-scale=${currentScale}`;
        meta.setAttribute("content", reset.content);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (zoomReset !== reset) return;
            zoomReset = null;
            meta.setAttribute("content", baseContent);
        }));
    }));
}

function guardHistoryZoomRestore(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const until = performance.now() + HISTORY_RESTORE_WINDOW_MS;
    const onResize = () => {
        if (performance.now() > until) viewport.removeEventListener("resize", onResize);
        else snapToBaseScale();
    };
    viewport.addEventListener("resize", onResize);
    snapToBaseScale();
    // A restore with no resize event left to catch is checked once more.
    window.setTimeout(() => {
        viewport.removeEventListener("resize", onResize);
        snapToBaseScale();
    }, HISTORY_RESTORE_WINDOW_MS);
}

/** Starts phone scaling. Call once at startup, before first paint. */
export function installMobileUiScale(): void {
    if (installed || typeof document === "undefined") return;
    installed = true;
    apply();
    window.screen.orientation?.addEventListener?.("change", apply);
    window.addEventListener("orientationchange", apply);
    // A foldable opening, or a window resized without rotating, changes the
    // screen without an orientation event. apply() reads screen size and
    // orientation, never innerWidth, so the resize its own meta write causes
    // settles on the same content instead of looping.
    window.addEventListener("resize", apply, { passive: true });
    if (document.readyState === "complete") guardHistoryZoomRestore();
    else window.addEventListener("load", guardHistoryZoomRestore, { once: true });
    window.addEventListener("pageshow", (event) => { if (event.persisted) guardHistoryZoomRestore(); });
    try { window.matchMedia("(pointer: coarse)").addEventListener("change", apply); } catch { /* old Safari */ }
}

/** Keeps the page at full scale until the returned release is called. */
export function holdFullScaleViewport(): () => void {
    holds += 1;
    if (installed) apply();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (installed) apply();
    };
}

/** Holds full scale while the calling component is mounted (and `active`). */
export function useFullScaleViewport(active = true): void {
    useLayoutEffect(() => (active ? holdFullScaleViewport() : undefined), [active]);
}
