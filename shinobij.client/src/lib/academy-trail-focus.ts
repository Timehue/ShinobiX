// "Find the trail" — the Academy coach's World Map chip asks the mounted World
// Map to re-aim at the Academy target sector. A window event rather than a
// prop: the coach portals out of App while the camera lives in WorldMap, and
// threading a callback through App.tsx would spend lines its size ratchet does
// not have. This module is deliberately dependency-free so the coach (initial
// bundle) does not pull the map's zoom hook and sector data in with it.

export const ACADEMY_TRAIL_FOCUS_EVENT = "academy:find-trail";

/** Ask the World Map, if it is mounted, to bring the Academy target sector back into view. */
export function requestAcademyTrailFocus(): void {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent(ACADEMY_TRAIL_FOCUS_EVENT));
}
