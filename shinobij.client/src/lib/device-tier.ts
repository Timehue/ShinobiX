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

/** True when the OS/browser requests reduced motion (WCAG 2.3.3). Read live
 *  (not cached) — a user can toggle it mid-session. SSR-safe. */
export function prefersReducedMotion(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch { return false; }
}

function detect(): boolean {
    try {
        const override = window.localStorage?.getItem("liteFx.v1");
        if (override === "1") return true;
        if (override === "0") return false;
    } catch { /* private mode — fall through to auto-detect */ }
    // Honour an explicit OS "reduce motion" request — drop decorative motion
    // regardless of hardware (the manual liteFx override above still wins).
    if (prefersReducedMotion()) return true;
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

let cachedCombat: boolean | undefined;

function detectLiteCombat(): boolean {
    // Manual override wins (shared with isLowEndMobile / applyLiteFxClass): "0"
    // forces FULL effects even on weak hardware, so honour it before any probe.
    try {
        const override = window.localStorage?.getItem("liteFx.v1");
        if (override === "1") return true;
        if (override === "0") return false;
    } catch { /* private mode — fall through to auto-detect */ }
    // Honour an explicit OS "reduce motion" request before the hardware probe.
    if (prefersReducedMotion()) return true;
    // Weak phones: reuse the existing touch-primary + weak-hardware check.
    if (isLowEndMobile()) return true;
    // Weak desktops / laptops: the heavy COMBAT layer (a rAF <canvas> particle
    // loop + per-cast sprite-frame swaps) can stutter on genuinely weak hardware
    // even with a mouse, so — unlike the decorative ambient gate, which leaves all
    // desktops at full fidelity — we do NOT exclude desktops here. Require BOTH
    // signals weak so a normal multi-core laptop keeps the effects; when
    // deviceMemory is unavailable (Firefox / Safari don't expose it) fall back to
    // a stricter core-only bar.
    try {
        const nav = navigator as Navigator & { deviceMemory?: number };
        const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
        const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;
        if (mem !== undefined && cores !== undefined) return mem <= 4 && cores <= 4;
        if (cores !== undefined) return cores <= 2;
        return false;
    } catch {
        return false;
    }
}

/** True when this device should skip the heavy COMBAT VFX layer — the player
 *  PvE particle canvas + jutsu sprite sheets and the PvP dash-trail flourish.
 *  A SUPERSET of isLowEndMobile(): it also catches weak desktops / laptops,
 *  which the decorative ambient gate deliberately leaves at full fidelity.
 *  Cosmetic only — never affects balance, saves, or shown info. Cached for the
 *  session; the `liteFx.v1` localStorage override forces it on ("1") or off
 *  ("0") for mis-detected devices / QA. SSR-safe (false when there's no window). */
export function prefersLiteCombatFx(): boolean {
    if (typeof window === "undefined") return false;
    if (cachedCombat === undefined) cachedCombat = detectLiteCombat();
    return cachedCombat;
}
