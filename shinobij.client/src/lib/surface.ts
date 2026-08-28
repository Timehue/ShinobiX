/*
 * Which surface is this document running on — the Play Store app, or the web?
 *
 * Used ONLY to vary UI affordances that genuinely differ by platform (the
 * Android hardware back button, an install promo, later the storefront button).
 * Every screen, feature and API call is identical on both; there is one build
 * and no fork.
 *
 * ⛔ NEVER an authority. The value is derived on the client and is therefore
 * forgeable, and the server cannot independently tell the surfaces apart — the
 * User-Agent is identical. Entitlements stay server-verified exactly as they are
 * today (see api/_subscription.ts): a Play purchase is trusted because its token
 * validates against Google's API, never because a client claimed to be the app.
 *
 * DETECTION, in order of reliability:
 *  1. `document.referrer` starts with `android-app://<package>` — Chrome's
 *     canonical TWA signal, set on the LAUNCH navigation. It does not survive a
 *     reload (including the boot-watchdog's "Reload latest game"), so the first
 *     answer is persisted for the tab and reused.
 *  2. Play Billing availability is a separate CAPABILITY check, not this flag —
 *     see canUsePlayBilling(). Gate purchase UI on that, because if it is absent
 *     the purchase cannot work regardless of what surface we think we are on.
 *
 * ⛔ NOT used: `display-mode: standalone`. It is true in a TWA *and* true for a
 * PWA installed from mobile Chrome via Add to Home Screen. Since the site now
 * ships a manifest, Add-to-Home-Screen users are real, and gating app-only UI on
 * standalone would hand them a back button (or later a purchase button) that
 * cannot work. Installed-ness and app-ness are different questions.
 */

export type Surface = 'play-app' | 'web';

/** sessionStorage, not localStorage: a tab opened from the app is the app for */
/** its lifetime, but a later browser visit must not inherit that verdict. */
const SURFACE_KEY = 'shinobix:surface.v1';
const ANDROID_APP_REFERRER = 'android-app://';

/**
 * Pure core: decide the surface from a referrer string.
 *
 * `expectedPackage` narrows the check to our own app. Any Android app can send
 * an `android-app://` referrer, and while nothing here is security-sensitive,
 * pinning it keeps a link shared from some other Android app from being counted
 * as our own launch.
 */
export function surfaceFromReferrer(referrer: string, expectedPackage?: string): Surface {
    const ref = String(referrer ?? '');
    if (!ref.startsWith(ANDROID_APP_REFERRER)) return 'web';
    if (!expectedPackage) return 'play-app';
    const pkg = ref.slice(ANDROID_APP_REFERRER.length).split('/')[0];
    return pkg === expectedPackage ? 'play-app' : 'web';
}

/** The package Bubblewrap builds. Empty until the Play listing exists, which */
/** simply means the referrer check stays unpinned — it does not disable it. */
const EXPECTED_PACKAGE = '';

let cached: Surface | undefined;

/**
 * The surface for this document. Resolved once per tab and remembered, because
 * the referrer that proves it is only present on the launch navigation.
 */
export function getSurface(): Surface {
    if (cached) return cached;
    if (typeof window === 'undefined' || typeof document === 'undefined') return 'web';

    let stored: string | null = null;
    try { stored = window.sessionStorage.getItem(SURFACE_KEY); } catch { /* private mode */ }
    if (stored === 'play-app' || stored === 'web') {
        cached = stored;
        return cached;
    }

    const resolved = surfaceFromReferrer(document.referrer, EXPECTED_PACKAGE || undefined);
    // Only the positive verdict is persisted. A 'web' reading may simply be a
    // reload that lost the referrer, and writing it would permanently demote an
    // app tab; leaving it unwritten lets a later launch still be recognised.
    if (resolved === 'play-app') {
        try { window.sessionStorage.setItem(SURFACE_KEY, resolved); } catch { /* private mode */ }
    }
    cached = resolved;
    return cached;
}

/** True in the Play Store app. Drives app-only UI affordances, nothing else. */
export function isPlayApp(): boolean {
    return getSurface() === 'play-app';
}

/**
 * Can this document actually charge through Google Play Billing?
 *
 * A capability probe, deliberately independent of getSurface(): the Digital
 * Goods API exists only inside a TWA on Chrome 101+, so a false answer means the
 * purchase genuinely cannot proceed and the web checkout must be offered
 * instead. Gate purchase UI on THIS, not on the surface flag.
 */
export function canUsePlayBilling(): boolean {
    if (typeof window === 'undefined') return false;
    return typeof (window as { getDigitalGoodsService?: unknown }).getDigitalGoodsService === 'function';
}

/** Test seam: clears the memoised verdict so a spec can re-resolve. */
export function resetSurfaceCacheForTests(): void {
    cached = undefined;
}
