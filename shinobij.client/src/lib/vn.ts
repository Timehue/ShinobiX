/*
 * Visual-novel asset path helpers.
 *
 * Pure lookups: given a speaker name or event id, return the URL path to
 * the matching portrait / scene asset. CSS / <img onError> silently fall
 * back to a default if the file is missing — these helpers don't probe.
 *
 * Drop new assets into shinobij.client/public/portraits/<slug>.png or
 * /scenes/<slug>.png to enable them; the helper builds the slug from
 * the speaker name / event id automatically.
 *
 * Extracted from App.tsx.
 */

/**
 * Slug-ifies a speaker name into a /portraits/<slug>.png path. Returns ""
 * for empty / Narrator / Player so callers can decide whether to hide
 * the portrait slot entirely.
 */
export function defaultVnPortrait(name: string | undefined | null): string {
    if (!name) return "";
    const n = name.trim().toLowerCase();
    if (!n || n === "narrator" || n === "player") return "";
    const slug = n.replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    return slug ? `/portraits/${slug}.png` : "";
}

/**
 * Best-fit scene background for a VN page. Tries an event-specific
 * /scenes/<eventid>.png first, then falls back to a biome default.
 * CSS background-image silently ignores 404s, so absent files just
 * fall through to the biome gradient — no broken-image icon shown.
 */
export function defaultVnScene(eventId?: string | null, biome?: string | null): string {
    if (eventId) {
        const slug = eventId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (slug) return `/scenes/${slug}.png`;
    }
    if (biome) {
        const slug = biome.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (slug) return `/scenes/${slug}.png`;
    }
    return "";
}
