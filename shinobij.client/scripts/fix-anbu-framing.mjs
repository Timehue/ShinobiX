// Anbu defender OUTPAINT repair — un-crop the four vault guardians.
//
//   public/anbu/<slug>.webp ──▶ pad to 1024 with head/foot room ──▶ gpt-image-1
//        /images/edits with a mask that opens ONLY the empty bands
//   ──▶ clip guard (alpha must not touch the frame) ──▶ sharp (trim + centre
//        on a 512 square with a real margin) ──▶ asset-gen-out/anbu-reframe/
//   ──▶ (--apply) copy over public/anbu/<slug>.webp
//
// Why an edit and not a re-roll: the four masks (fox / wolf / owl / hawk) are
// the villages' signatures, so the characters have to survive the fix. The
// shipped file is the reference image, and each village's authored palette
// vocabulary rides along in the prompt to hold the identity through the redraw.
// (The mask does NOT preserve pixels — see the note above promptFor.)
//
// The bug being repaired: gen-anbu-vault-art.mjs asked for a "full-body …
// single character centered" figure but never asked for MARGIN, so gpt-image-1
// composed all four edge to edge and the hood crowns and boot soles were sliced
// off by the frame. That prompt is fixed there too, but these four files had
// already shipped, and a re-roll would hand every village a new face.
//
// Run from shinobij.client/ (sharp + the OpenAI key live here):
//   node scripts/fix-anbu-framing.mjs --dry-run
//   node scripts/fix-anbu-framing.mjs --only moonshadow
//   node scripts/fix-anbu-framing.mjs                 # writes staging only
//   node scripts/fix-anbu-framing.mjs --apply         # + overwrite public/anbu
//
// Staged files are reused unless --force, so reviewing and then applying costs
// nothing extra.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, "..");
const PUBLIC_DIR = path.join(CLIENT_ROOT, "public", "anbu");
const OUT_DIR = path.join(CLIENT_ROOT, "asset-gen-out", "anbu-reframe");
const MAIN_ENV = "C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/.env";

// KEEP IN SYNC with ANBU_AVATAR_BY_VILLAGE (src/lib/anbu-infiltration-api.ts)
// and the ANBU list in gen-anbu-vault-art.mjs — the theme strings are that
// script's verbatim, so the repaired art lands back on the same palette the
// village was authored with.
const ANBU = {
    moonshadow: "a pale bone-white porcelain OWL mask with deep violet markings, indigo-and-charcoal cloak edged in cold silver, faint moonlit violet rim light",
    stormveil: "a slate-grey porcelain HAWK mask with jade-green markings, mossy deep-green and dark slate cloak, faint teal storm-light rim glow",
    ashenleaf: "a charcoal porcelain FOX mask with smouldering ember-orange markings, ash-grey and black cloak with faint glowing orange trim, warm ember rim light",
    frostfang: "a frost-white porcelain fanged-WOLF mask with pale cyan markings, frost-white and steel-blue cloak, cold icy-blue rim light",
};
const SLUGS = Object.keys(ANBU).sort();

// Canvas plan at 1024 — the figure is placed inside this box so the model is
// handed a reference that already SHOWS where the head and feet should end.
const TOP_PAD = 150;
const BOT_PAD = 110;
const SIDE_PAD = 70;
const OVERLAP = 10; // the mask bites this far into the figure so the seam blends
const BORDER = 80;  // locked transparent frame the model is not allowed to paint into

// The mask is load-bearing, but NOT for preservation. gpt-image-1's edit
// endpoint is generative: it re-renders (and re-poses) the whole canvas mask or
// no mask, and locking a transparent border in the mask does not stop it
// painting there — measured, 91 opaque px on row 0 of an edit whose mask locked
// the top 80 rows. What the mask DOES buy is the alpha: without one the model
// ignores `background: transparent` and paints an opaque olive backdrop.
//
// So framing cannot be commanded, only sampled: the prompt asks for margin, the
// clip guard measures it, and attemptsFor() re-rolls and keeps the best-framed
// answer. The village palette vocabulary holds the character through the redraw.
function promptFor(slug) {
    return [
        "This painterly anime RPG illustration of a masked ANBU black-ops shinobi —",
        ANBU[slug] + " — has been cropped: the top of the hood and the soles of the boots run off the frame.",
        "Paint in the missing hood crown and the missing boot soles so the figure is whole.",
        "Everything already drawn stays exactly as it is: same mask shape and markings, same cloak and outfit colours, same guarded ready stance, same proportions, same brushwork and lighting.",
        "Frame the finished figure smaller than the canvas, with a clear band of empty space above the hood and below the boots; no part of the character may touch an edge.",
        "Transparent background, no ground plane, no scene, no shadow, no text, no watermark.",
    ].join(" ");
}

function envValue(name) {
    if (process.env[name]) return process.env[name].trim();
    for (const envPath of [path.join(CLIENT_ROOT, ".env"), MAIN_ENV]) {
        if (!fs.existsSync(envPath)) continue;
        for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
            const m = line.match(new RegExp("^" + name + "\\s*=\\s*(.+)$"));
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

function parseArgs(argv) {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) { flags._.push(a); continue; }
        const key = a.slice(2);
        if (key === "apply" || key === "dry-run" || key === "force") flags[key] = true;
        else flags[key] = argv[++i];
    }
    return flags;
}

const flags = parseArgs(process.argv.slice(2));
const ATTEMPTS = Math.max(1, Number(flags.attempts) || 3);
const only = (flags.only || "").split(",").map(s => s.trim()).filter(Boolean);
const queue = SLUGS.filter(s => only.length === 0 || only.includes(s));
if (queue.length === 0) {
    console.error("error: --only matched nothing. Slugs: " + SLUGS.join(", "));
    process.exit(1);
}

const sharp = (await import("sharp")).default;

// A subject that merely stops one pixel short of the frame is still a crop
// waiting to happen, so "clipped" means "closer to an edge than this".
const MIN_MARGIN = 0.012;
// Alpha below INK is background, above it is the figure. gpt-image-1's
// transparent output is not a hard cutout — it comes back with a translucent
// film over the whole canvas (a raw edit here measured mean alpha 77 with fully
// transparent corners), so a naive "alpha > 0" bbox spans the entire frame and
// every framing check reads as clipped. Everything below thresholds on this.
const INK = 128;

/** Ramp the alpha so the model's translucent film becomes real transparency. */
async function cleanAlpha(pngBytes, lo = 64, hi = 176) {
    const { data, info } = await sharp(pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += info.channels) {
        const a = data[i];
        data[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) / (hi - lo)) * 255);
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

/** The subject's alpha bounding box, plus the raster it was measured on. */
async function inkBox(buf) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: ch } = info;
    let top = -1, bottom = -1, left = w, right = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * ch + 3] < INK) continue;
            if (top < 0) top = y;
            bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
        }
    }
    return { w, h, top, bottom, left, right, empty: top < 0 };
}

/** Which frame edges the subject runs off (or crowds) — the bug's signature. */
async function clippedEdges(buf) {
    const b = await inkBox(buf);
    if (b.empty) return ["EMPTY"];
    const needV = Math.max(1, Math.round(b.h * MIN_MARGIN));
    const needH = Math.max(1, Math.round(b.w * MIN_MARGIN));
    const edges = [];
    if (b.top < needV) edges.push("top");
    if (b.h - 1 - b.bottom < needV) edges.push("bottom");
    if (b.left < needH) edges.push("left");
    if (b.w - 1 - b.right < needH) edges.push("right");
    return edges;
}

/** Tightest margin as a fraction of the frame — how close this attempt came. */
async function frameScore(buf) {
    const b = await inkBox(buf);
    if (b.empty) return -1;
    return Math.min(b.top / b.h, (b.h - 1 - b.bottom) / b.h, b.left / b.w, (b.w - 1 - b.right) / b.w);
}

/** Crop a buffer down to its subject — the only reliable trim on hazy alpha. */
async function trimToInk(buf) {
    const b = await inkBox(buf);
    if (b.empty) return buf;
    return sharp(buf).ensureAlpha()
        .extract({ left: b.left, top: b.top, width: b.right - b.left + 1, height: b.bottom - b.top + 1 })
        .png().toBuffer();
}

/** The padded 1024 base the model edits: the figure placed with room to grow. */
async function buildBase(srcFile) {
    const figure = await trimToInk(await sharp(srcFile).ensureAlpha().png().toBuffer());
    const meta = await sharp(figure).metadata();
    const boxW = 1024 - SIDE_PAD * 2;
    const boxH = 1024 - TOP_PAD - BOT_PAD;
    const scale = Math.min(boxW / meta.width, boxH / meta.height);
    const w = Math.max(1, Math.round(meta.width * scale));
    const h = Math.max(1, Math.round(meta.height * scale));
    const resized = await sharp(figure).resize(w, h).png().toBuffer();
    return sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: resized, left: Math.round((1024 - w) / 2), top: TOP_PAD + Math.round((boxH - h) / 2) }])
        .png().toBuffer();
}

/** The mask: OPAQUE = keep, TRANSPARENT = the model may paint here.
 *
 *  Two open bands, NOT two open edges. Left to the frame edge the model paints
 *  the new hood crown right off the top again (measured: 17 opaque px on row 0
 *  of a masked edit) — it wants to fill the canvas. Locking BORDER px of
 *  already-transparent base along the top and bottom leaves it nowhere to put
 *  the overflow, so the margin survives the redraw. */
async function buildMask() {
    const px = Buffer.alloc(1024 * 1024 * 4, 255); // opaque white = preserve
    const openRow = (y) => (y >= BORDER && y < TOP_PAD + OVERLAP)
        || (y >= 1024 - BOT_PAD - OVERLAP && y < 1024 - BORDER);
    for (let y = 0; y < 1024; y++) {
        if (!openRow(y)) continue;
        for (let x = 0; x < 1024; x++) px[(y * 1024 + x) * 4 + 3] = 0;
    }
    return sharp(px, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
}

async function openaiEdit(apiKey, imageBytes, maskBytes, slug) {
    const fd = new FormData();
    fd.append("model", "gpt-image-1");
    // The Blob MUST carry an image/* MIME type — a typeless Blob uploads as
    // application/octet-stream, which the API rejects (same trap as
    // gen-pet-battle-sprites.mjs).
    fd.append("image[]", new Blob([imageBytes], { type: "image/png" }), "anbu.png");
    fd.append("mask", new Blob([maskBytes], { type: "image/png" }), "mask.png");
    fd.append("prompt", promptFor(slug));
    fd.append("size", "1024x1024");
    fd.append("quality", flags["gen-quality"] || "high");
    fd.append("background", "transparent");
    fd.append("output_format", "png");
    fd.append("n", "1");
    // This offline repair tool intentionally sends the shipped asset and the configured credential to OpenAI.
    // codeql[js/file-access-to-http]
    const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey },
        body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? ("OpenAI " + res.status));
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image data");
    return Buffer.from(b64, "base64");
}

/** Trim to the subject and centre it on a 512 square with a real margin. */
async function finish(pngBytes) {
    const figure = await trimToInk(pngBytes);
    const meta = await sharp(figure).metadata();
    const inner = Math.round(512 * 0.94);
    const scale = Math.min(inner / meta.width, inner / meta.height);
    const w = Math.max(1, Math.round(meta.width * scale));
    const h = Math.max(1, Math.round(meta.height * scale));
    const resized = await sharp(figure).resize(w, h).png().toBuffer();
    return sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: resized, left: Math.round((512 - w) / 2), top: Math.round((512 - h) / 2) }])
        .webp({ quality: 88, effort: 6 })
        .toBuffer();
}

if (flags["dry-run"]) {
    for (const slug of queue) {
        const src = path.join(PUBLIC_DIR, slug + ".webp");
        const edges = fs.existsSync(src) ? await clippedEdges(fs.readFileSync(src)) : ["MISSING"];
        const staged = fs.existsSync(path.join(OUT_DIR, slug + ".webp"));
        console.log((staged ? "[have]" : "[edit]") + " " + slug.padEnd(12) + " clipped: " + (edges.length ? edges.join(",") : "none"));
    }
    process.exit(0);
}

const apiKey = envValue("OPENAI_API_KEY");
if (!apiKey) { console.error("error: OPENAI_API_KEY not found (env / .env / main-checkout .env)."); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const mask = await buildMask();
fs.writeFileSync(path.join(OUT_DIR, "_mask.png"), mask);

for (const slug of queue) {
    const src = path.join(PUBLIC_DIR, slug + ".webp");
    const rawFile = path.join(OUT_DIR, slug + ".raw.png");
    const outWebp = path.join(OUT_DIR, slug + ".webp");
    try {
        // The model's answer is cached as .raw.png, so re-running only re-does
        // the free local post-processing. --force is what spends money.
        let raw;
        if (!flags.force && fs.existsSync(rawFile)) {
            raw = fs.readFileSync(rawFile);
            console.log("  cached raw       " + slug);
        } else {
            const base = await buildBase(src);
            fs.writeFileSync(path.join(OUT_DIR, slug + ".base.png"), base);
            // Framing is stochastic, so sample it: keep the roomiest answer, and
            // stop early the moment one clears the guard.
            let best = null, bestScore = -Infinity;
            for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
                const candidate = await openaiEdit(apiKey, base, mask, slug);
                const score = await frameScore(await cleanAlpha(candidate));
                console.log("    attempt " + attempt + "/" + ATTEMPTS + "  " + slug.padEnd(12) + " margin " + (score * 100).toFixed(1) + "%");
                if (score > bestScore) { best = candidate; bestScore = score; }
                if (bestScore >= MIN_MARGIN) break;
            }
            raw = best;
            fs.writeFileSync(rawFile, raw);
        }
        const cleaned = await cleanAlpha(raw);
        const edges = await clippedEdges(cleaned);
        const webp = await finish(cleaned);
        fs.writeFileSync(outWebp, webp);
        await sharp(webp).png().toFile(path.join(OUT_DIR, slug + ".preview.png"));
        const verdict = edges.length ? "SUBJECT CLIPPED (" + edges.join(",") + ") — re-run with --force" : "clean";
        console.log("  staged " + (webp.length / 1024).toFixed(0).padStart(3) + "KB   " + slug.padEnd(12) + " " + verdict);
    } catch (err) {
        console.error("  FAILED           " + slug + ": " + err.message);
    }
}

if (flags.apply) {
    for (const slug of queue) {
        const staged = path.join(OUT_DIR, slug + ".webp");
        if (!fs.existsSync(staged)) { console.error("  skip apply       " + slug + " (nothing staged)"); continue; }
        const edges = await clippedEdges(fs.readFileSync(staged));
        if (edges.length) { console.error("  REFUSED apply    " + slug + " — staged art still touches " + edges.join(",")); continue; }
        fs.copyFileSync(staged, path.join(PUBLIC_DIR, slug + ".webp"));
        console.log("  applied          " + slug + " → public/anbu/" + slug + ".webp");
    }
}
console.log("\ndone.");
