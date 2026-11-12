import framesByElement from 'virtual:jutsu-fx-frames';

/**
 * The ordered frame URLs for a jutsu element's bundled sprite effect, or null
 * if none is bundled (caller then uses the particle fallback). Folder names are
 * the lowercased element; "lava" has its own folder, "none"/neutral maps to the
 * generic explosion.
 */
export function bundledJutsuFxFrames(element?: string | null): string[] | null {
    const key = String(element ?? "").toLowerCase();
    const folder =
        framesByElement[key] ? key :
        (key === "" || key === "neutral") ? "none" :
        "";
    const frames = folder ? framesByElement[folder] : null;
    return frames && frames.length ? frames : null;
}
