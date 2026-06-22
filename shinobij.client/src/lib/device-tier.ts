/*
 * device-tier — one shared "is this a weak mobile device?" check used to gate
 * purely-decorative effects OFF on low-end phones so the hub / world / sector
 * screens stay smooth, while capable phones and all desktops keep the full
 * living-world look.
 *
 * A device counts as low-end when it is TOUCH-primary (coarse pointer) AND
 * reports weak hardware: navigator.deviceMemory <= 4 GB OR hardwareConcurrency
 * <= 4 cores. deviceMemory is Chromium/Android-only, so iOS Safari (iPhones)
 * falls through as "not low-end" — which is what we want; iPhones handle the
 * effects fine. A manual override lives in localStorage `liteFx.v1`
 * ("1" = force lite, "0" = force full) for mis-detected devices and QA.
 *
 * COSMETIC ONLY: nothing here affects gameplay, balance, saves, or what
 * information is shown — it only decides how much decorative motion is drawn.
 * Consumers: SectorScene3D, SceneAmbience3D, SceneAmbience, SceneCritters, and
 * the `.lite-fx` CSS overrides applied to <html> by applyLiteFxClass().
 */

let cached: boolean | undefined;

function detect(): boolean {
    try {
        const override = window.localStorage?.getItem("liteFx.v1");
        if (override === "1") return true;
        if (override === "0") return false;
    } catch { /* private mode — fall through to auto-detect */ }
    try {
        const nav = navigator as Navigator & { deviceMemory?: number };
        const mq = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
        const touchPrimary = mq ? mq.matches : (nav.maxTouchPoints ?? 0) > 0;
        if (!touchPrimary) return false; // desktops keep everything
        const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
        const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;
        return (mem !== undefined && mem <= 4) || (cores !== undefined && cores <= 4);
    } catch {
        return false;
    }
}

/** True on an auto-detected (or manually-forced) weak mobile device. Computed
 *  once and cached for the session. SSR-safe (false when there's no window). */
export function isLowEndMobile(): boolean {
    if (typeof window === "undefined") return false;
    if (cached === undefined) cached = detect();
    return cached;
}

/** Tag <html> with `lite-fx` on weak devices so CSS can drop decorative
 *  (non-gameplay) animations. Call once at startup, before first paint. */
export function applyLiteFxClass(): void {
    if (typeof document === "undefined") return;
    if (isLowEndMobile()) document.documentElement.classList.add("lite-fx");
}
