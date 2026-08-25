/*
 * Guards for the Chronicle card art srcset.
 *
 * Card art is authored at 768px but displayed at 62-252px everywhere except the
 * inspector, so a 512px variant carries every other surface. Two ways that goes
 * wrong and neither throws:
 *   - a srcset pointing at a variant that was never generated 404s, and the
 *     img's onError handler REMOVES the element, so the card renders blank;
 *   - an admin-published overlay or data: URL has no variant at all, so it must
 *     pass through untouched.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CHRONICLE_CARD_CATALOG } from "../lib/chronicle-duel";
import {
    chronicleCardArtSrcSet,
    CARD_ART_SIZES_DEFAULT,
    CARD_ART_SIZES_INSPECTOR,
    CARD_ART_SIZES_PACK,
} from "../lib/chronicle-card-art";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "..", "public");

test("catalog art gets both widths, in ascending order", () => {
    const srcSet = chronicleCardArtSrcSet("/chronicle/cards/chronicle-ashen-veil.webp");
    assert.equal(
        srcSet,
        "/chronicle/cards/chronicle-ashen-veil-512.webp 512w, /chronicle/cards/chronicle-ashen-veil.webp 768w",
    );
});

test("non-catalog art is left alone", () => {
    for (const image of [
        "data:image/webp;base64,AAAA",
        "/portraits/chronicle-scribe-ihara.webp",
        "/chronicle/fields/some-field.webp",
        "/chronicle/cards/nested/deeper.webp",
        "https://example.test/remote.webp",
    ]) {
        assert.equal(
            chronicleCardArtSrcSet(image),
            undefined,
            `${image} has no generated variant; emitting a srcset for it would 404 into blank art`,
        );
    }
});

test("every catalog card that claims a srcset has that variant on disk", () => {
    const missing: string[] = [];
    const notSmaller: string[] = [];
    let checked = 0;

    for (const card of CHRONICLE_CARD_CATALOG) {
        const image = card.image;
        if (!image) continue;
        const srcSet = chronicleCardArtSrcSet(image);
        if (!srcSet) continue;
        checked += 1;

        const variant = image.replace(/\.webp$/, "-512.webp");
        const variantPath = path.join(publicDir, variant.replace(/^\//, ""));
        const originalPath = path.join(publicDir, image.replace(/^\//, ""));
        if (!existsSync(variantPath)) { missing.push(variant); continue; }
        if (!existsSync(originalPath)) continue; // the original is the catalog's problem, not ours
        if (statSync(variantPath).size >= statSync(originalPath).size) notSmaller.push(variant);
    }

    assert.ok(checked > 100, `expected the card catalog to be covered, checked only ${checked}`);
    assert.deepEqual(missing, [], "run `node scripts/generate-card-variants.mjs`");
    assert.deepEqual(notSmaller, [], "a variant no smaller than the original defeats the point");
});

/*
 * The `sizes` constants restate widths that actually live in CSS (and, for Pack
 * Opening, in a JS transform clamp). If a designer changes the CSS and these do
 * not follow, the failure is silent: an overstated hint makes every card fetch
 * the 768px original, an understated one renders a soft upscale. Nothing else
 * would catch either.
 */
test("size hints still match the CSS/JS they mirror", () => {
    const styles = path.resolve(here, "..", "styles");
    const duelCss = readFileSync(path.join(styles, "chronicle-duel.css"), "utf8");
    const packTsx = readFileSync(path.join(here, "CardPackOpening.tsx"), "utf8");

    // .chronicle-card { width: 252px }
    const base = duelCss.match(/\.chronicle-card \{[^}]*?width:\s*(\d+)px/s);
    assert.ok(base, "could not find the base .chronicle-card width");
    assert.equal(
        CARD_ART_SIZES_DEFAULT,
        `${base[1]}px`,
        "the base card width changed in chronicle-duel.css; update CARD_ART_SIZES_DEFAULT",
    );

    // .chronicle-card-zoom .chronicle-card { width: min(390px, 74vw, 45vh) }
    const zoom = duelCss.match(/\.chronicle-card-zoom \.chronicle-card \{[^}]*?width:\s*(min\([^)]*\))/s);
    assert.ok(zoom, "could not find the inspector card width");
    assert.equal(
        CARD_ART_SIZES_INSPECTOR.replace(/\s+/g, ""),
        zoom[1].replace(/\s+/g, ""),
        "the inspector card width changed; update CARD_ART_SIZES_INSPECTOR",
    );

    // CardPackOpening clamps: Math.min(1.25, (vw * 0.82) / 252, (vh * 0.5) / 353)
    const clamp = packTsx.match(/Math\.min\(([\d.]+),\s*\(vw \* ([\d.]+)\) \/ (\d+),\s*\(vh \* ([\d.]+)\) \/ (\d+)\)/);
    assert.ok(clamp, "could not find the Pack Opening scale clamp");
    const [, maxScale, vwFactor, vwDiv, vhFactor, vhDiv] = clamp;
    const baseWidth = Number(base[1]);
    const expectedPx = Math.round(baseWidth * Number(maxScale));
    const expectedVw = Math.round(Number(vwFactor) * 100);
    // The card is width-driven, so the vh arm converts through the card's aspect.
    const expectedVh = Math.round((Number(vhFactor) * 100 * baseWidth) / Number(vhDiv));
    assert.equal(
        CARD_ART_SIZES_PACK.replace(/\s+/g, ""),
        `min(${expectedPx}px,${expectedVw}vw,${expectedVh}vh)`,
        `Pack Opening's scale clamp changed (max ${maxScale}x, ${vwFactor}vw/${vwDiv}, ${vhFactor}vh/${vhDiv}); `
        + "update CARD_ART_SIZES_PACK",
    );
});
