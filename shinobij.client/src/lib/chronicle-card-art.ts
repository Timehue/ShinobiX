/*
 * Chronicle card art delivery.
 *
 * Card art is authored at 768x1097 (~207 KB each; 47 MB across the 233-card
 * catalog), but that resolution only earns its bytes in the card inspector,
 * where `.chronicle-card-zoom .chronicle-card` is `width: min(390px, 74vw,
 * 45vh)` and so wants ~780 px on a 2x display. Every other surface is far
 * smaller, so a browsing player was downloading 3-7x the pixels they could see:
 *
 *   duel board zone   `repeat(5, minmax(62px, 112px))`    -> ~224 px at 2x
 *   collection grid   `repeat(auto-fill, minmax(226px,))` -> ~452 px at 2x
 *   base card         `.chronicle-card { width: 252px }`  -> ~504 px at 2x
 *
 * scripts/generate-card-variants.mjs emits a 512px sibling for each card
 * (47.0 MB -> 14.6 MB for the set). Offering both widths in a srcset lets the
 * browser pick per surface and per device pixel ratio. Verified in-browser:
 * 224/452/504 px slots all resolve to the 512px variant (63 KB) and only the
 * 780 px inspector slot pulls the original (223 KB). The art shown is identical.
 *
 * Only catalog art directly under /chronicle/cards/ has a generated variant.
 * Admin-published overlay images and data: URLs must pass through untouched —
 * emitting a srcset for a file that was never generated would 404, and
 * ChronicleCardView's onError handler REMOVES the img, so the card would render
 * with blank art rather than a visible error.
 */

/** Width of the generated small variant. Keep in sync with
 *  scripts/generate-card-variants.mjs `VARIANT_WIDTH`. */
export const CARD_ART_VARIANT_WIDTH = 512;

/** Intrinsic width of the authored card art. */
export const CARD_ART_INTRINSIC_WIDTH = 768;

/*
 * `sizes` hints, one per surface that renders a card at a distinct width. Each
 * mirrors a real CSS rule — keep them in sync with styles/chronicle-duel.css and
 * styles/card-pack-opening.css, because a hint that overstates the width makes
 * every card fetch the 768px original, and one that understates it renders a
 * soft upscale.
 */

/** `.chronicle-card { width: 252px }` — the base card, and the ceiling for the
 *  collection grid (226px) and the compact board tiles (62-112px). */
export const CARD_ART_SIZES_DEFAULT = "252px";

/** `.chronicle-card-zoom .chronicle-card { width: min(390px, 74vw, 45vh) }` —
 *  the inspector, the only surface that wants the full-resolution art. */
export const CARD_ART_SIZES_INSPECTOR = "min(390px, 74vw, 45vh)";

/** Pack Opening. The card stays 252px in layout but takes a
 *  `transform: scale(var(--card-scale))`, and CardPackOpening clamps that scale
 *  to `max(0.55, min(1.25, vw*0.82/252, vh*0.5/353))`. A transform does not
 *  change the layout box, so `sizes` cannot see it — the effective width has to
 *  be restated here: 252*1.25 = 315px, 0.82vw, and 0.5vh*252/353 ≈ 36vh. */
export const CARD_ART_SIZES_PACK = "min(315px, 82vw, 36vh)";

/** Catalog art only: one path segment under /chronicle/cards/, ending .webp,
 *  and never an already-generated variant. */
const CATALOG_ART = /^\/chronicle\/cards\/[^/]+\.webp$/;

export function chronicleCardArtSrcSet(image: string): string | undefined {
    if (!CATALOG_ART.test(image)) return undefined;
    if (image.endsWith(`-${CARD_ART_VARIANT_WIDTH}.webp`)) return undefined;
    const variant = image.replace(/\.webp$/, `-${CARD_ART_VARIANT_WIDTH}.webp`);
    return `${variant} ${CARD_ART_VARIANT_WIDTH}w, ${image} ${CARD_ART_INTRINSIC_WIDTH}w`;
}
