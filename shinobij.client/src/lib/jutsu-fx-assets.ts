/*
 * Bundled jutsu-FX frame sequences — the CC0 "Pixel Magic Effects" (Foozle)
 * frames extracted into src/assets/fx/<element>/NNN.png. Loaded at build time
 * via Vite's import.meta.glob so they ship in the bundle (works on both Vercel
 * and the cPanel/Express static serve).
 *
 * CLIENT-ONLY: this module uses import.meta.glob (a Vite feature) and therefore
 * is NOT node-testable — keep it out of the test runner. The pure element →
 * palette/burst logic lives in jutsu-vfx.ts instead.
 *
 * Bundled today: fire, water, earth, wind, lava, none (Foozle) + lightning, ice
 * (Ninja Adventure). An element with no folder (shadow / blood / iron, and the
 * pet-only poison/chakra keys) returns null and the renderer falls back to the
 * procedural element-tinted particle burst. Adding fx/<element>/ frames is all
 * it takes to give one a sprite — no code change.
 */

// eager: resolve URLs at build time; import the default (the asset URL string).
const modules = import.meta.glob("../assets/fx/*/*.png", {
    eager: true,
    import: "default",
}) as Record<string, string>;

// Group frame URLs by their folder (= element key), ordered by source filename
// (001.png, 002.png, …) so playback runs in sequence regardless of build hashing.
const framesByElement: Record<string, string[]> = (() => {
    const byKey: Record<string, Array<{ path: string; url: string }>> = {};
    for (const [path, url] of Object.entries(modules)) {
        const m = /\/fx\/([^/]+)\/[^/]+\.png$/.exec(path);
        if (!m) continue;
        (byKey[m[1]] ||= []).push({ path, url });
    }
    const out: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(byKey)) {
        out[key] = list.sort((a, b) => a.path.localeCompare(b.path)).map((e) => e.url);
    }
    return out;
})();

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

/** Element keys that currently have a bundled sprite (for diagnostics/tests). */
export function bundledFxElements(): string[] {
    return Object.keys(framesByElement).sort();
}
