import type { CSSProperties } from "react";

/**
 * Hands a combat action card its own art as a CSS custom property so the card
 * can paint a blurred, scaled copy of it behind the sharp one.
 *
 * Every piece of card art is square (generated jutsu art is 1024x1024, catalog
 * item art 320x320) while the wide card is landscape, so fitting the whole
 * image leaves a gutter either side. Filling that gutter with flat gradient
 * made every card identical in the dead space; filling it with the card's own
 * blurred colours inks the whole tile without cropping a pixel.
 *
 * Returns undefined when there is no art — the declaration then never lands, the
 * `var()` stays unset, and the backdrop resolves to `none` on its own.
 */
export function cardArtBackdrop(art: unknown): CSSProperties | undefined {
    if (typeof art !== "string" || !art) return undefined;
    // This value is interpolated into a `url("…")` token. Published art is an
    // /api/img URL or a base64 data URL, and neither can contain a quote,
    // backslash, parenthesis or whitespace — so anything that could terminate
    // the token early is rejected rather than escaped.
    if (/["'\\()\s]/.test(art)) return undefined;
    return { "--combat-card-art": `url("${art}")` } as CSSProperties;
}
