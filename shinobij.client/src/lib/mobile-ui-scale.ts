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

/**
 * Read once at install. Playwright's touch emulation reports a fine pointer for
 * a moment around reloads and resizes; re-reading it switched the page to 1.0,
 * and Chrome then saved and restored that zoom. A phone's pointer type does not
 * change mid-session, and a mouse plugged in takes effect on the next load.
 */
let coarsePointer = false;

function isPortraitPhone(): boolean {
    try {
        if (!coarsePointer) return false;
        if (isWebKitOnlyBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) return false;
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
    if (meta.getAttribute("content") === content) return;
    // Write the meta and nothing else. Two earlier guards made things worse.
    // A maximum-scale cap lifted two frames later zoomed the page to 1.0 (e2e
    // timeline: 0.852, cap, release, 1.000 16 ms later). A "zoom is stuck"
    // fallback misread the moment after a reload, when Chrome briefly restores
    // a held screen's 1.0, and kept every later menu at 1.0. Chrome follows the
    // next meta change on its own (e2e/mobile-ui-scale-reload.spec.ts).
    meta.setAttribute("content", content);
}

/** Starts phone scaling. Call once at startup, before first paint. */
export function installMobileUiScale(): void {
    if (installed || typeof document === "undefined") return;
    installed = true;
    try { coarsePointer = window.matchMedia("(pointer: coarse)").matches; } catch { coarsePointer = false; }
    apply();
    window.screen.orientation?.addEventListener?.("change", apply);
    window.addEventListener("orientationchange", apply);
    // A foldable opening, or a window resized without rotating, changes the
    // screen without an orientation event. apply() reads screen size and
    // orientation, never innerWidth, so the resize its own meta write causes
    // settles on the same content instead of looping.
    window.addEventListener("resize", apply, { passive: true });
    // Deliberately no `(pointer: coarse)` change listener; see coarsePointer.
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
