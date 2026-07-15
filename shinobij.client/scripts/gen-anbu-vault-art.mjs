// Anbu Vault Infiltration art batch — the sector-base reskin + item icons.
//
//   curated prompts ──▶ OpenAI gpt-image-1 ──▶ sharp (resize + WebP) ──▶ asset-gen-out/anbu-vault/
//                                                                   └──▶ (--publish) POST /api/images (shrine:* ids only)
//
// Mirrors gen-hollow-gate-tiles.mjs (same engine, same env resolution). Three
// asset groups (docs/anbu-infiltration-plan.md §14):
//
//   1. The "warvault" ROOM THEME — 5 terrain tiles + 2 decos published under the
//      Hollow-Gate theme key convention (shrine:icon-theme-warvault-*). The theme
//      is DELIBERATELY NOT added to HOLLOW_GATE_THEMES (data/hollow-gate-atlas.ts),
//      so pickRoomTheme can never roll it in a real Hollow Gate run — only the
//      infiltration mode stamps it. Separate modes, shared renderer.
//   2. The sector-surface vault LANDMARK — the 2.5D structure players see and
//      click in an enemy-held war sector (static file → public/landmarks/,
//      the rift-structure convention; NOT published to shared images).
//   3. The two war-cache ITEM ICONS (inventory event items; static files, wired
//      into the client at UI time).
//
// Look: a fortified shinobi war-vault — cold slate/steel-blue stone, dark iron
// banding, faint crimson ward-seals — deliberately distinct from the violet
// cursed-shrine palette so the two dungeons never read as the same place.
//
// Run from shinobij.client/ (sharp + the OpenAI key live here):
//   node scripts/gen-anbu-vault-art.mjs --dry-run
//   node scripts/gen-anbu-vault-art.mjs --only warvault-floor
//   node scripts/gen-anbu-vault-art.mjs
//   node scripts/gen-anbu-vault-art.mjs --publish --server https://shinobijourney.com
//
// Idempotent: existing .webp files in asset-gen-out/anbu-vault are skipped
// (delete to redo); --publish re-publishes the shrine:* ids on disk.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trustedPublishOrigin } from "./_trusted-tool-io.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(CLIENT_ROOT, "asset-gen-out", "anbu-vault");
const MAIN_ENV = "C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/.env";

function envValue(name) {
    if (process.env[name]) return process.env[name].trim();
    for (const envPath of [path.join(CLIENT_ROOT, ".env"), MAIN_ENV]) {
        if (!fs.existsSync(envPath)) continue;
        for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
            const m = line.match(new RegExp(`^${name}\\s*=\\s*(.+)$`));
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

// ── Shared prompt vocabulary (identical tile rules to the shrine batch, so the
//    renderer's seamless 48px cells read the same) ────────────────────────────
const TILE_RULES = "flat top-down orthographic dungeon floor-tile texture for a 2D tile-based game, fills the entire square frame edge to edge, seamless repeating pattern that tiles perfectly with itself, uniform even ambient lighting, no perspective, no shadows cast by off-frame objects, no vignette, no border, no frame, no centered object, no text, no watermark";
const FACE_RULES = "straight-on front elevation view of a dungeon wall section for a 2D tile-based game, fills the entire square frame edge to edge, seamless horizontally repeating masonry that tiles perfectly with itself, uniform even ambient lighting, no perspective, no vignette, no border, no frame, no text, no watermark";
const DECO_RULES = "single small dungeon prop object, top-down three-quarter view, sitting on the ground, transparent background, no floor tile beneath it, no scene, no border, no shadow baked in far from the base, cold slate-and-iron war-vault palette, subtle rim light, cohesive with a fortified shinobi village war vault, no text, no watermark, no modern objects";
const ICON_RULES = "single game inventory item icon, three-quarter view, transparent background, no scene, no border, no frame, clean silhouette, subtle rim light, painterly anime RPG style, no text, no watermark";

// The warvault palette vocabulary.
const WV = {
    floor: "fitted cold slate-grey stone flagstones with thin dark iron strapping set flush between some slabs, palette around hex #3a4150 with steel-blue undertones, faint crimson ward-seal painted worn and flaking on occasional slabs, clean military upkeep",
    corridor: "tight cold dark slate paving of narrow rectangular slabs, palette around hex #262c38, a worn central treadpath from patrol boots, thin iron drainage strip along one seam",
    wallTop: "dark slate stone wall-top surface seen from directly above, near-black steel-blue palette around hex #171c26, large flat precision-cut blocks with hairline seams and subtle cold edge highlights, matte",
    wallFace: "massive fitted slate-grey stone brick courses reinforced with horizontal dark iron bands and heavy rivets, palette around hex #333b49, faint cold blue reflected light near the bottom edge, one faded crimson ward-seal stencil on a single block",
    door: "reinforced vault threshold seen from directly above: a dark iron-banded stone slab with a circular crimson ward-seal engraving at its centre, heavy riveted jamb blocks left and right, palette around hex #2a303d",
};

const ASSETS = [];
function add(name, id, prompt, opts = {}) {
    ASSETS.push({
        name, id, prompt,
        size: opts.size ?? "1024x1024",
        maxPx: opts.maxPx ?? 256,
        quality: opts.quality ?? "medium",
        styleWrap: opts.styleWrap ?? false,
        transparent: opts.transparent ?? false,
        // where the local .webp should ALSO be copied ('' = nowhere; publish handles shrine ids)
        copyTo: opts.copyTo ?? "",
        publish: opts.publish ?? false,
    });
}

// ── 1. The warvault room theme (shrine:icon-theme-warvault-*) ────────────────
add("warvault-floor",     "shrine:icon-theme-warvault-floor",     `${WV.floor}, part of a fortified war vault, ${TILE_RULES}`,   { publish: true });
add("warvault-wall",      "shrine:icon-theme-warvault-wall",      `${WV.wallTop}, part of a fortified war vault, ${TILE_RULES}`, { publish: true });
add("warvault-wall-face", "shrine:icon-theme-warvault-wall-face", `${WV.wallFace}, part of a fortified war vault, ${FACE_RULES}`, { publish: true });
add("warvault-corridor",  "shrine:icon-theme-warvault-corridor",  `${WV.corridor}, part of a fortified war vault, ${TILE_RULES}`, { publish: true });
add("warvault-door",      "shrine:icon-theme-warvault-door",      `${WV.door}, part of a fortified war vault, ${TILE_RULES}`,     { publish: true });
add("warvault-deco-1",    "shrine:icon-theme-warvault-deco-1",
    `a neat stack of dark wooden war-supply crates strapped with iron banding, a small stenciled crimson seal on one crate, ${DECO_RULES}`,
    { transparent: true, publish: true });
add("warvault-deco-2",    "shrine:icon-theme-warvault-deco-2",
    `a squat dark iron strongbox with heavy rivets and a glowing crimson ward-seal padlock, ${DECO_RULES}`,
    { transparent: true, publish: true });

// ── 2. The sector-surface vault landmark (public/landmarks/anbu-vault.webp) ──
add("anbu-vault-landmark", "landmark:anbu-vault",
    "a small fortified shinobi war-vault compound seen from a high three-quarter isometric view: a squat stone blockhouse with dark iron-banded walls built into a rocky rise, a heavy sealed vault gate at its front marked with a glowing crimson ward-seal, two watch-braziers burning cold blue, a war banner on a short pole, cold slate-and-steel palette, painterly anime RPG style, single structure on a transparent background, no ground plane extending beyond the structure's base, no text, no watermark",
    { transparent: true, maxPx: 512, quality: "high", copyTo: path.join(CLIENT_ROOT, "public", "landmarks", "anbu-vault.webp") });

// ── 3. The two war-cache item icons (public/items/) ──────────────────────────
add("war-supply-cache", "item:war-supply-cache",
    `a compact field cache of shinobi war supplies: a dark wooden crate cracked open showing bundled ration scrolls, kunai wrapped in cord and a coil of rope, iron banding, a small crimson supply-seal stamp, ${ICON_RULES}`,
    { transparent: true, copyTo: path.join(CLIENT_ROOT, "public", "items", "war-supply-cache.webp") });
add("war-resource-cache", "item:war-resource-cache",
    `a sealed war-resource strongbox: a small dark iron coffer overflowing with rolled requisition scrolls and a few steel ingots, a glowing crimson ward-seal clasp, ${ICON_RULES}`,
    { transparent: true, copyTo: path.join(CLIENT_ROOT, "public", "items", "war-resource-cache.webp") });

// ── 4. The per-village Anbu defenders (public/anbu/<slug>.webp) ──────────────
// The masked guardian that stands in the vault's boss room. Anbu are anonymous
// masked operatives, so each village gets a signature masked figure (the real
// appointee's LOADOUT still drives combat — this is only the face). Themed to
// the village biome. slug KEEP IN SYNC with the client's ANBU_AVATAR_BY_VILLAGE.
const ANBU_FIGURE = "full-body three-quarter view of a masked ANBU black-ops shinobi standing in a guarded ready stance, anonymous, signature porcelain animal mask, fitted dark stealth bodysuit with arm guards and a short hooded cloak, a tanto blade sheathed across the back, painterly anime shinobi RPG style, single character centered, transparent background, no ground plane, no scene, no text, no watermark";
const ANBU = [
    { slug: "moonshadow", theme: "a pale bone-white porcelain OWL mask with deep violet markings, indigo-and-charcoal cloak edged in cold silver, faint moonlit violet rim light" },
    { slug: "stormveil", theme: "a slate-grey porcelain HAWK mask with jade-green markings, mossy deep-green and dark slate cloak, faint teal storm-light rim glow" },
    { slug: "ashenleaf", theme: "a charcoal porcelain FOX mask with smouldering ember-orange markings, ash-grey and black cloak with faint glowing orange trim, warm ember rim light" },
    { slug: "frostfang", theme: "a frost-white porcelain fanged-WOLF mask with pale cyan markings, frost-white and steel-blue cloak, cold icy-blue rim light" },
];
for (const a of ANBU) {
    add(`anbu-${a.slug}`, `anbu:${a.slug}`, `${ANBU_FIGURE}, wearing ${a.theme}`,
        { transparent: true, maxPx: 512, quality: "high", copyTo: path.join(CLIENT_ROOT, "public", "anbu", `${a.slug}.webp`) });
}

// ── Engine (mirrors gen-hollow-gate-tiles.mjs) ───────────────────────────────
function parseArgs(argv) {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            if (key === "publish" || key === "dry-run" || key === "force") flags[key] = true;
            else flags[key] = argv[++i];
        } else flags._.push(a);
    }
    return flags;
}

const flags = parseArgs(process.argv.slice(2));
const only = (flags.only || "").trim();
const queue = ASSETS.filter(a => !only || a.name === only || a.id === only);
if (queue.length === 0) {
    console.error(`error: --only "${only}" matched nothing. Names: ${ASSETS.map(a => a.name).join(", ")}`);
    process.exit(1);
}

const outFileFor = (asset) => path.join(OUT_DIR, `${asset.id.replace(/[^a-zA-Z0-9._-]+/g, "_")}.webp`);

if (flags["dry-run"]) {
    for (const a of queue) {
        const exists = fs.existsSync(outFileFor(a));
        console.log(`${exists ? "[have]" : "[gen ]"} ${a.name.padEnd(22)} ${a.id.padEnd(40)} ${a.size} q=${a.quality} max=${a.maxPx}px${a.publish ? " publish" : ""}${a.copyTo ? " copy" : ""}`);
    }
    console.log(`\n${queue.length} assets · ${queue.filter(a => !fs.existsSync(outFileFor(a))).length} to generate`);
    process.exit(0);
}

const apiKey = envValue("OPENAI_API_KEY");
if (!apiKey) { console.error("error: OPENAI_API_KEY not found (env / .env / main-checkout .env)."); process.exit(1); }

async function generateOne(asset) {
    const outFile = outFileFor(asset);
    if (!flags.force && fs.existsSync(outFile)) { copyIfNeeded(asset, outFile); return { asset, status: "cached" }; }
    // This offline generator intentionally sends its curated prompt and configured API credential to OpenAI.
    // codeql[js/file-access-to-http]
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gpt-image-1", prompt: asset.prompt, size: asset.size, quality: asset.quality, n: 1,
            ...(asset.transparent ? { background: "transparent", output_format: "png" } : {}),
        }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message ?? "generation failed"}`);
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image data");
    const sharp = (await import("sharp")).default;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const webp = await sharp(Buffer.from(b64, "base64"))
        .resize({ width: asset.maxPx, height: asset.maxPx, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80, effort: 6 })
        .toBuffer();
    fs.writeFileSync(outFile, webp);
    await sharp(webp).png().toFile(outFile.replace(/\.webp$/, ".preview.png"));
    fs.writeFileSync(outFile.replace(/\.webp$/, ".txt"), `${asset.id}\n\n${asset.prompt}\n`);
    copyIfNeeded(asset, outFile);
    return { asset, status: `generated ${(webp.length / 1024).toFixed(0)}KB` };
}

function copyIfNeeded(asset, outFile) {
    if (!asset.copyTo || !fs.existsSync(outFile)) return;
    fs.mkdirSync(path.dirname(asset.copyTo), { recursive: true });
    fs.copyFileSync(outFile, asset.copyTo);
}

async function publishOne(asset, server, adminPw) {
    if (!asset.publish) return { asset, status: "skip (local-only)" };
    const outFile = outFileFor(asset);
    if (!fs.existsSync(outFile)) return { asset, status: "missing (not generated)" };
    const webp = fs.readFileSync(outFile);
    // Local asset bytes are intentionally uploaded after the target-origin allowlist check.
    // codeql[js/file-access-to-http]
    const res = await fetch(`${server}/api/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
        body: JSON.stringify({ id: asset.id, image: `data:image/webp;base64,${webp.toString("base64")}` }),
    });
    if (!res.ok) throw new Error(`publish ${asset.id} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return { asset, status: "published" };
}

async function runPool(items, worker, concurrency) {
    const results = [];
    let i = 0;
    async function lane() {
        while (i < items.length) {
            const item = items[i++];
            try {
                const r = await worker(item);
                console.log(`  ${r.status.padEnd(16)} ${item.name} (${item.id})`);
                results.push(r);
            } catch (err) {
                console.error(`  FAILED           ${item.name}: ${err.message}`);
                results.push({ asset: item, status: "failed" });
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, lane));
    return results;
}

console.log(`generating ${queue.length} assets (concurrency 3)…`);
const genResults = await runPool(queue, generateOne, 3);
const failed = genResults.filter(r => r.status === "failed");
if (failed.length) console.error(`\n${failed.length} generation(s) failed — re-run to retry (cached files skip).`);

if (flags.publish) {
    const server = trustedPublishOrigin(flags.server || "https://shinobijourney.com");
    const adminPw = envValue("ADMIN_PASSWORD");
    if (!adminPw) { console.error("error: --publish needs ADMIN_PASSWORD (env / .env / main-checkout .env)."); process.exit(1); }
    console.log(`\npublishing to ${server} …`);
    await runPool(queue, (a) => publishOne(a, server, adminPw), 3);
}
console.log("\ndone.");
