/*
 * generate-card-variants — build the small Chronicle card art used everywhere
 * except the zoom modal.
 *
 * The authored card art is 768x1097 (~207 KB each, 47 MB across 233 cards), and
 * that resolution is only justified in ONE place: the card inspector, where
 * `.chronicle-card-zoom .chronicle-card` is `width: min(390px, 74vw, 45vh)` and
 * therefore wants ~780 px on a 2x display. Every other surface is far smaller:
 *
 *   duel board zone   `repeat(5, minmax(62px, 112px))`   -> ~224 px at 2x
 *   collection grid   `repeat(auto-fill, minmax(226px,)` -> ~452 px at 2x
 *   base card         `.chronicle-card { width: 252px }` -> ~504 px at 2x
 *
 * So a 512 px variant covers every non-zoom surface at 2x while the original
 * stays available for the inspector. ChronicleCardView emits both in a `srcset`
 * and lets the browser choose; nothing here changes what art a card shows.
 *
 * Sizing note: WebP q80 + effort 6 matches the project's existing convention
 * (scripts/to-webp.mjs), and vite.config.ts deliberately EXCLUDES .webp from the
 * build-time optimizer, so these files ship exactly as written — no second
 * lossy pass.
 *
 * Usage:  node scripts/generate-card-variants.mjs [--check]
 *   --check  verify every source has an up-to-date variant; exit 1 if not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(root, "public", "chronicle", "cards");
const check = process.argv.includes("--check");

/** Width of the generated variant. See the header for where this comes from. */
export const VARIANT_WIDTH = 512;
const SUFFIX = `-${VARIANT_WIDTH}.webp`;

const sources = fs
    .readdirSync(cardsDir)
    .filter((f) => f.endsWith(".webp") && !f.endsWith(SUFFIX))
    .sort();

if (sources.length === 0) {
    console.error(`[card-variants] no source art in ${cardsDir}`);
    process.exit(1);
}

const variantFor = (file) => file.replace(/\.webp$/, SUFFIX);

function isStale(file) {
    const out = path.join(cardsDir, variantFor(file));
    if (!fs.existsSync(out)) return true;
    return fs.statSync(out).mtimeMs < fs.statSync(path.join(cardsDir, file)).mtimeMs;
}

if (check) {
    const stale = sources.filter(isStale).map(variantFor);
    if (stale.length) {
        console.error(`[card-variants] ${stale.length} variant(s) missing or stale:`);
        for (const s of stale.slice(0, 10)) console.error(`  ${s}`);
        if (stale.length > 10) console.error(`  ... and ${stale.length - 10} more`);
        console.error("[card-variants] run: node scripts/generate-card-variants.mjs");
        process.exit(1);
    }
    console.log(`[card-variants] OK — ${sources.length} cards each have a current ${VARIANT_WIDTH}px variant.`);
    process.exit(0);
}

let sourceBytes = 0;
let variantBytes = 0;
let skipped = 0;

for (const file of sources) {
    const src = path.join(cardsDir, file);
    const out = path.join(cardsDir, variantFor(file));
    const meta = await sharp(src).metadata();

    // Never upscale: art already at or below the variant width is its own
    // best small form, and emitting a larger "small" file would be a
    // regression the srcset would then happily download.
    if ((meta.width ?? 0) <= VARIANT_WIDTH) {
        skipped += 1;
        continue;
    }

    await sharp(src)
        .resize({ width: VARIANT_WIDTH, withoutEnlargement: true })
        .webp({ quality: 80, effort: 6 })
        .toFile(out);

    sourceBytes += fs.statSync(src).size;
    variantBytes += fs.statSync(out).size;
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(
    `[card-variants] ${sources.length - skipped} variants at ${VARIANT_WIDTH}px: `
    + `${mb(sourceBytes)} -> ${mb(variantBytes)} `
    + `(${(100 - (variantBytes / sourceBytes) * 100).toFixed(1)}% smaller)`
    + (skipped ? `; ${skipped} already <= ${VARIANT_WIDTH}px, skipped` : ""),
);
