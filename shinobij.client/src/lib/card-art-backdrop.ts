import type { CSSProperties } from "react";

/**
 * Hands an art frame its own image as a CSS custom property, so the frame can
 * paint a blurred, scaled copy of it behind the sharp one.
 *
 * Game art is mostly square (generated jutsu/AI art is 1024x1024, catalog item
 * art 320x320, sector paintings 1024x1024) while the frames that show it are
 * often wide banners. Fitting the whole image leaves an empty gutter either
 * side. Flat gradient in that gutter made every card identical in the dead
 * space and read as unfinished; the art's own blurred colours ink the whole
 * frame without cropping a pixel.
 *
 * Returns undefined when there is no art — the declaration then never lands, the
 * `var()` stays unset, and the backdrop resolves to `none` on its own.
 */
export function artBackdropStyle(art: unknown, property: `--${string}` = "--art-backdrop"): CSSProperties | undefined {
    if (typeof art !== "string" || !art) return undefined;
    // This value is interpolated into a `url("…")` token. Published art is an
    // /api/img URL, a static asset path or a base64 data URL, and none of them
    // can contain a quote, backslash, parenthesis or whitespace — so anything
    // that could terminate the token early is rejected rather than escaped.
    if (/["'\\()\s]/.test(art)) return undefined;
    return { [property]: `url("${art}")` } as CSSProperties;
}

/** Combat action cards: sets `--combat-card-art` (read by battle-skin.css). */
export function cardArtBackdrop(art: unknown): CSSProperties | undefined {
    return artBackdropStyle(art, "--combat-card-art");
}
