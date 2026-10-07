/*
 * Artwork tooling for the upgrade gear (step) items. See docs/gear-step-art-handoff.md.
 *
 *   node --import tsx scripts/gear-step-art.mjs manifest
 *       Writes docs/gear-step-art-manifest.csv, one row per step item, from the
 *       LIVE catalog (so names, values and reference art cannot drift).
 *   node --import tsx scripts/gear-step-art.mjs import <folder> [--dry]
 *       Turns finished images named <stepId>.png (or .jpg/.webp) into the game's
 *       320x320 transparent webp at shinobij.client/public/items/step-<id>-v1.webp,
 *       then regenerates shared/gear-step-art-ready.ts. A step item switches from
 *       its base item's art to its own art only once its id is in that list.
 *
 * Pure helpers are exported for scripts/gear-step-art.test.ts.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { starterItems } from "../shinobij.client/src/data/starter-items.ts";
import { parseStepItemId, gearTierOf, stepCount } from "../shared/gear-steps.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = join(ROOT, "docs", "gear-step-art-manifest.csv");
export const READY_PATH = join(ROOT, "shared", "gear-step-art-ready.ts");
export const ITEMS_DIR = join(ROOT, "shinobij.client", "public", "items");

export const CANVAS = 320;
const FIT = 300;
const KEY = "#FF00FF";

const WEAPON_TIER_NAMES = ["Common weapons", "Rare weapons", "Epic weapons"];
const WEAPON_NEXT_NAMES = ["Rare weapons", "Epic weapons", "Legendary weapons"];
const ARMOR_TIER_NAMES = ["Standard armor", "Reinforced armor", "Rare armor"];
const ARMOR_NEXT_NAMES = ["Reinforced armor", "Rare armor", "Legendary armor"];

// What each rung adds on top of everything the base item already has. A rung is
// always a small refinement of the SAME object, never a different design.
const WEAPON_LOOK = {
    Whetted: "A fresh edge. The blade is cleaned and sharpened with a bright new bevel, rust and chips from the base are mostly gone, and the grip wrap is tidy.",
    Honed: "A fine polished edge with a crisp clean highlight along the whole blade, tight neat grip wrapping, and small metal fittings polished bright.",
    Tempered: "A visible wavy temper line along the edge, a faint blue steel sheen, clean bronze fittings, and a richer colour in the grip wrap.",
    Folded: "Folded steel: fine layered grain lines across the metal, a crisp bright edge, and bronze or silver fittings with a little engraving.",
    "Shadow Forged": "Dark forged steel with a deep blackened finish and a bright edge, engraved fittings, and a very faint cool glow only along the cutting edge. It is the most refined version of this weapon, but it is still a plain working weapon: no aura, no flames, no glowing runes.",
};
const ARMOR_LOOK = {
    Mended: "Freshly mended: neat clean stitching over old tears, a few new patches, replaced cords and buckles, and colours a little cleaner than the base.",
    Lacquered: "Fresh lacquer: plates and leather coated in a clean glossy lacquer sheen, polished edges and fasteners, and deeper richer colours.",
    Ironstitched: "Iron stitched: extra iron thread stitching along the seams and added riveted plate edging, with all metal crisp and bright. It is the strongest version of this piece but is still clearly plainer than the next quality tier.",
};

const WEAPON_RUNGS_5 = ["Whetted", "Honed", "Tempered", "Folded", "Shadow Forged"];
const WEAPON_RUNGS_3 = ["Honed", "Tempered", "Folded"];
const ARMOR_RUNGS = ["Mended", "Lacquered", "Ironstitched"];

const csvCell =(value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** One row per step item, built from the live catalog. */
export function buildManifestRows(items = starterItems) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const rows = [];
    for (const item of items) {
        const parsed = parseStepItemId(item.id);
        if (!parsed) continue;
        const base = byId.get(parsed.baseId);
        if (!base) throw new Error(`step item ${item.id} has no base item`);
        const { kind, tier } = gearTierOf(base);
        const total = stepCount(kind, tier);
        // Pieces now have their own names, so the art direction rung comes from the step number.
        const rungWord = (kind === "armor" ? ARMOR_RUNGS : total === 5 ? WEAPON_RUNGS_5 : WEAPON_RUNGS_3)[parsed.step - 1];
        const look = (kind === "weapon" ? WEAPON_LOOK : ARMOR_LOOK)[rungWord];
        if (!look) throw new Error(`no art direction for rung "${rungWord}" (${item.id})`);
        const tierName = (kind === "weapon" ? WEAPON_TIER_NAMES : ARMOR_TIER_NAMES)[tier];
        const nextName = (kind === "weapon" ? WEAPON_NEXT_NAMES : ARMOR_NEXT_NAMES)[tier];
        const value = kind === "weapon" ? `${item.weaponEp} EP` : `${Math.round(item.armorReduction * 1000) / 10}% damage reduction`;
        const prompt = [
            `Use the attached image of the ${base.name} as the exact reference. Keep the same ${kind === "weapon" ? "weapon" : "piece of armor"}, pose, angle, silhouette, proportions, colour family and painted game icon style.`,
            `Make it a clear but modest upgrade called the ${item.name}, rung ${parsed.step} of ${total} between ${tierName} and ${nextName}. ${look}`,
            `It must look better than the ${base.name} and clearly less impressive than ${nextName}.`,
            `Draw it on a flat solid magenta (${KEY}) background with no shadow, no floor, no glow spill, no text, and no frame. No magenta or hot pink anywhere on the item itself. Square image, the item fills about 90 percent of the frame, nothing cropped.`,
        ].join(" ");
        rows.push({
            step_id: item.id,
            file_name: `${item.id}.png`,
            kind,
            name: item.name,
            tier: tierName,
            rung: `${parsed.step} of ${total}`,
            value,
            base_id: base.id,
            base_name: base.name,
            reference_image: `shinobij.client/public${base.image}`,
            prompt,
        });
    }
    return rows;
}

export function manifestCsv(rows = buildManifestRows()) {
    const columns = ["step_id", "file_name", "kind", "name", "tier", "rung", "value", "base_id", "base_name", "reference_image", "prompt"];
    return [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
}

export function readyListSource(ids) {
    const list = [...ids].sort();
    return `/*
 * Step item ids that have their own art in shinobij.client/public/items/.
 * GENERATED by \`node --import tsx scripts/gear-step-art.mjs import <folder>\`.
 * Do not edit by hand. A step item not listed here shows its base item's art.
 * scripts/gear-step-art.test.mjs keeps this list and the files in step.
 */
export const GEAR_STEP_ART_READY: readonly string[] = [${list.length ? `\n${list.map((id) => `    "${id}",`).join("\n")}\n` : ""}];
`;
}

/** Ids that currently have a finished file on disk. */
export function stepArtOnDisk(dir = ITEMS_DIR, items = starterItems) {
    const known = new Set(items.filter((item) => parseStepItemId(item.id)).map((item) => item.id));
    const found = [];
    for (const file of readdirSync(dir)) {
        const match = /^step-(.+)-v1\.webp$/.exec(file);
        if (match && known.has(match[1])) found.push(match[1]);
    }
    return found.sort();
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Cut the subject out of its background and frame it on the game canvas.
 * Handles both a flat colour background (any colour, read from the corners) and
 * an image that already has transparency. Returns { buffer, problems, notes }.
 */
export async function processArt(input) {
    const source = sharp(input).ensureAlpha();
    const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const px = (x, y) => (y * width + x) * 4;
    const corners = [];
    const block = Math.max(2, Math.floor(Math.min(width, height) * 0.01));
    for (const [cx, cy] of [[0, 0], [width - block, 0], [0, height - block], [width - block, height - block]]) {
        for (let y = cy; y < cy + block; y++) for (let x = cx; x < cx + block; x++) corners.push(px(x, y));
    }
    const cornerAlpha = median(corners.map((i) => data[i + 3]));
    const transparentInput = cornerAlpha < 40;
    const key = transparentInput ? null : [0, 1, 2].map((channel) => median(corners.map((i) => data[i + channel])));
    const out = Buffer.alloc(width * height * 4);
    // A saturated key such as magenta can be told apart from the item by how much
    // red AND blue sit above green. That gives the exact share of key colour that
    // bled into each soft edge pixel, which is what the despill needs.
    const spillKey = key && key[0] > 150 && key[2] > 150 && key[1] < 110;
    const keySpill = spillKey ? Math.min(key[0], key[2]) - key[1] : 0;
    // Only pixels within a few pixels of the background are treated as edge. The
    // inside of the item is never touched, so a genuinely purple item stays purple.
    const isBackground = new Uint8Array(width * height);
    if (spillKey) {
        for (let i = 0; i < width * height; i++) {
            const o = i * 4;
            if (Math.hypot(data[o] - key[0], data[o + 1] - key[1], data[o + 2] - key[2]) < 100) isBackground[i] = 1;
        }
    }
    const nearBackground = new Uint8Array(width * height);
    if (spillKey) {
        const radius = Math.max(3, Math.round(Math.min(width, height) / 200));
        const across = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    if (nx >= 0 && nx < width && isBackground[y * width + nx]) { across[y * width + x] = 1; break; }
                }
            }
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    const ny = y + dy;
                    if (ny >= 0 && ny < height && across[ny * width + x]) { nearBackground[y * width + x] = 1; break; }
                }
            }
        }
    }
    for (let i = 0; i < width * height; i++) {
        const o = i * 4;
        let alpha;
        if (transparentInput) {
            // "Transparent" output often arrives as a translucent film: ramp it to a clean cutout.
            alpha = Math.max(0, Math.min(255, Math.round(((data[o + 3] - 64) / (176 - 64)) * 255)));
            out[o] = data[o]; out[o + 1] = data[o + 1]; out[o + 2] = data[o + 2];
        } else if (spillKey) {
            if (isBackground[i]) {
                alpha = 0;
            } else if (nearBackground[i]) {
                const share = Math.max(0, Math.min(1, (Math.min(data[o], data[o + 2]) - data[o + 1]) / keySpill));
                alpha = Math.round((1 - share) * 255);
                for (let c = 0; c < 3; c++) {
                    const clean = share < 0.95 ? (data[o + c] - share * key[c]) / (1 - share) : data[o + c];
                    out[o + c] = Math.max(0, Math.min(255, Math.round(clean)));
                }
            } else {
                alpha = 255;
                out[o] = data[o]; out[o + 1] = data[o + 1]; out[o + 2] = data[o + 2];
            }
        } else {
            const distance = Math.hypot(data[o] - key[0], data[o + 1] - key[1], data[o + 2] - key[2]);
            const coverage = Math.max(0, Math.min(1, (distance - 40) / (95 - 40)));
            alpha = Math.round(coverage * 255);
            for (let c = 0; c < 3; c++) {
                // Remove the background colour that bleeds into soft edges.
                const clean = coverage > 0 ? (data[o + c] - (1 - coverage) * key[c]) / coverage : data[o + c];
                out[o + c] = Math.max(0, Math.min(255, Math.round(clean)));
            }
        }
        out[o + 3] = alpha;
    }
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (out[px(x, y) + 3] < 128) continue;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    }
    const problems = [];
    if (maxX < 0) return { buffer: null, problems: ["nothing left after removing the background"], notes: [] };
    const edge = Math.max(1, Math.floor(Math.min(width, height) * 0.01));
    if (minX < edge || minY < edge || maxX >= width - edge || maxY >= height - edge) problems.push("the item touches the edge of the picture, so it looks cropped");
    const span = Math.max(maxX - minX + 1, maxY - minY + 1) / Math.min(width, height);
    if (span < 0.5) problems.push(`the item only fills ${Math.round(span * 100)} percent of the picture`);
    const subject = await sharp(out, { raw: { width, height, channels: 4 } })
        .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
        .resize(FIT, FIT, { fit: "inside", kernel: "lanczos3" })
        .png()
        .toBuffer();
    const meta = await sharp(subject).metadata();
    const framed = sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: subject, left: Math.round((CANVAS - meta.width) / 2), top: Math.round((CANVAS - meta.height) / 2) }]);
    let quality = 86;
    let buffer = await framed.clone().webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer();
    while (buffer.length > 40_000 && quality > 60) {
        quality -= 6;
        buffer = await framed.clone().webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer();
    }
    return { buffer, problems, notes: [transparentInput ? "transparent input" : `keyed from rgb(${key.join(",")})`, `${(buffer.length / 1024).toFixed(1)} KB at quality ${quality}`] };
}

async function runImport(folder, dry) {
    const known = new Map(buildManifestRows().map((row) => [row.step_id, row]));
    const files = readdirSync(folder).filter((file) => /\.(png|jpe?g|webp)$/i.test(file) && statSync(join(folder, file)).isFile());
    let accepted = 0;
    let rejected = 0;
    for (const file of files) {
        const id = basename(file, extname(file));
        if (!known.has(id)) { console.log(`skip   ${file}: not a step item id (expected a name from the manifest file_name column)`); rejected++; continue; }
        const result = await processArt(join(folder, file));
        if (!result.buffer || result.problems.length) { console.log(`REJECT ${file}: ${result.problems.join("; ")}`); rejected++; continue; }
        if (!dry) {
            mkdirSync(ITEMS_DIR, { recursive: true });
            writeFileSync(join(ITEMS_DIR, `step-${id}-v1.webp`), result.buffer);
        }
        console.log(`${dry ? "ok    " : "wrote "} ${id}  (${result.notes.join(", ")})`);
        accepted++;
    }
    if (!dry) writeFileSync(READY_PATH, readyListSource(stepArtOnDisk()));
    const remaining = known.size - stepArtOnDisk().length;
    console.log(`\n${accepted} accepted, ${rejected} rejected, ${remaining} of ${known.size} step items still use their base item's art.`);
    if (!dry && accepted) console.log(`Updated ${READY_PATH}. Review the new files in shinobij.client/public/items/, then commit them with that list.`);
    if (rejected) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, folder, flag] = process.argv.slice(2);
    if (command === "manifest") {
        writeFileSync(MANIFEST_PATH, manifestCsv());
        console.log(`Wrote ${MANIFEST_PATH} (${buildManifestRows().length} rows).`);
    } else if (command === "import" && folder && existsSync(folder)) {
        await runImport(folder, flag === "--dry");
    } else {
        console.log("usage: node --import tsx scripts/gear-step-art.mjs manifest\n       node --import tsx scripts/gear-step-art.mjs import <folder> [--dry]");
        process.exitCode = 2;
    }
}
