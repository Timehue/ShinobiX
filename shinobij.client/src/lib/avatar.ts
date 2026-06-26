/*
 * Avatar source detection. A combatant's "avatar" field can be either an IMAGE
 * (render as <img>) or a short TEXT fallback (an emoji like "🥷" or initials like
 * "EN" — render as text). The battle HUD historically only recognised data URLs,
 * blob URLs, and the /api/img disk-overlay path — which silently broke bundled
 * Vite asset URLs (e.g. the Sector-Wanderer / quest-boss portraits at
 * `/assets/bandit-*.webp`): those fell through and rendered the URL *as text*.
 *
 * This recognises any real image source — data/blob/http(s) or any absolute path
 * (which covers /api/img AND /assets/...) — while leaving emoji/initials/empty as
 * text. Avatar text fallbacks are never paths, so a leading "/" is a safe tell.
 */
export function isImageAvatar(src: string | null | undefined): boolean {
    if (!src) return false;
    return src.startsWith("data:image")
        || src.startsWith("blob:")
        || src.startsWith("http")
        || src.startsWith("/");
}
