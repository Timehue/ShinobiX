/** Lightweight battlefield-theme lookup for pre-match UI.
 *
 * Keep this module dependency-free: importing the procedural Warfront map from
 * PetArena eagerly pulled its baked walkmask into the landing route.
 */
export type WfTheme = "central" | "forest" | "snow" | "volcano" | "shadow";

export function wfThemeForVillage(village?: string | null): WfTheme {
    const value = String(village ?? "").toLowerCase();
    if (/leaf|forest|green|grove|verdant/.test(value)) return "forest";
    if (/snow|frost|ice|glacier|white/.test(value)) return "snow";
    if (/fire|volcano|ember|cinder|ash|lava/.test(value)) return "volcano";
    if (/shadow|umbra|night|dusk|dark/.test(value)) return "shadow";
    return "central";
}
