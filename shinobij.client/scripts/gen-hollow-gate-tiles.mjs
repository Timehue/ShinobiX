// Hollow Gate terrain art batch — the Spirit-Tracks renderer's tileset.
//
//   curated prompts ──▶ OpenAI gpt-image-1 ──▶ sharp (resize + WebP) ──▶ asset-gen-out/shrine/
//                                                                   └──▶ (--publish) POST /api/images
//
// Replaces the old 16×16 atlas-slice terrain (muddy at the new 48px seamless
// cells) with purpose-painted tile textures: base wall tops, the NEW wall-face
// key (south-facing masonry the renderer draws with depth), floor + corridor
// variants, doors, all four room themes (crypt / ember / sanctum / ruins), and
// the key-art backdrop. Content icons (shrine:icon-*) are untouched — they are
// already bespoke transparent art.
//
// Terrain prompts deliberately SKIP the house style-wrapper (gen-asset.mjs
// styleWrap): its "dramatic lighting / clean composition" rules fight flat
// seamless textures and produce centered hero objects. The backdrop keeps it.
//
// Run from shinobij.client/ (sharp + the OpenAI key live here):
//   node scripts/gen-hollow-gate-tiles.mjs --dry-run          # list plan, no spend
//   node scripts/gen-hollow-gate-tiles.mjs --only crypt-floor # one asset
//   node scripts/gen-hollow-gate-tiles.mjs                    # generate all missing
//   node scripts/gen-hollow-gate-tiles.mjs --publish --server https://shinobijourney.com
//
// Idempotent: an asset whose .webp already exists in asset-gen-out/shrine is
// skipped for generation (delete the file to redo it); --publish re-publishes
// everything on disk. OPENAI_API_KEY / ADMIN_PASSWORD resolve from env, this
// worktree's shinobij.client/.env, or the MAIN checkout's .env (untracked).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trustedPublishOrigin } from "./_trusted-tool-io.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(CLIENT_ROOT, "asset-gen-out", "shrine");
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

// ── Shared prompt vocabulary ─────────────────────────────────────────────────
// Every terrain tile: flat, frame-filling, tileable, evenly lit. The palette is
// anchored to the app's CSS dungeon colours so art and chrome read as one.
const TILE_RULES = "flat top-down orthographic dungeon floor-tile texture for a 2D tile-based game, fills the entire square frame edge to edge, seamless repeating pattern that tiles perfectly with itself, uniform even ambient lighting, no perspective, no shadows cast by off-frame objects, no vignette, no border, no frame, no centered object, no text, no watermark";
const FACE_RULES = "straight-on front elevation view of a dungeon wall section for a 2D tile-based game, fills the entire square frame edge to edge, seamless horizontally repeating masonry that tiles perfectly with itself, uniform even ambient lighting, no perspective, no vignette, no border, no frame, no text, no watermark";

// Base palette (matches .hg-* CSS): violet-grey stone over near-black.
const BASE = {
    floor: "ancient worn stone flagstones, large irregular slabs with thin dark mortar seams, deep muted violet-grey palette around hex #3f2f68 with subtle cooler and warmer patches, faint hairline cracks and soft wear",
    corridor: "tight ancient stone paving of smaller darker slabs, deep dark violet palette around hex #271d46, worn treadpath down the middle, thin mortar seams, subtle grit and pebbles",
    wallTop: "dark stone ceiling-top surface of a dungeon wall seen from directly above, near-black violet palette around hex #1a1128, large flat chiseled blocks with very subtle edge highlights, matte",
    wallFace: "massive fitted stone brick courses, muted violet-grey palette around hex #3c2b5a, weathered chisel marks, faint cool purple reflected light near the bottom edge",
    door: "ancient stone doorway threshold seen from directly above: a worn engraved stone slab framed by two dark jamb blocks left and right, faint violet chakra glow tracing the engraving, palette around hex #2c1e4c",
};

// Theme accents — same geometry vocabulary, different dressing, so rooms feel
// distinct without breaking the set. (Themes: data/hollow-gate-atlas.ts.)
const THEMES = {
    crypt: {
        note: "cold funerary crypt",
        floor: "cold grey-violet crypt flagstones with occasional small carved bone-white sigil inlays and hairline frost-pale mineral veins",
        wallTop: "near-black cold grey-violet stone wall tops, tight fitted blocks, faint pale dust in the crevices",
        wallFace: "solid cold grey-violet crypt masonry, two or three courses of very large weathered fitted stone blocks, one thin bone-white inlay seam line between two courses, subtle pale mineral bloom, no niches, no openings, no arches",
        corridor: "cold dark grey-violet crypt paving, narrow slabs, pale dust drifts along the mortar seams",
        door: "crypt threshold slab engraved with a funerary seal ring, bone-white inlay glinting faintly, dark grey-violet stone",
    },
    ember: {
        note: "scorched ember vault",
        floor: "charred violet-black basalt flagstones with thin smoldering orange ember cracks glowing between some slabs, sparse warm ash flecks",
        wallTop: "charred near-black basalt wall tops with the faintest warm ember glow tracing a few deep cracks",
        wallFace: "scorched dark basalt masonry with veins of smoldering orange ember light between weathered brick courses, soft heat-haze glow near the base",
        corridor: "charred dark basalt paving, tight slabs, faint warm ember pinpricks in the seams",
        door: "blackened stone threshold slab with an engraved flame seal glowing soft ember-orange, dark basalt jambs",
    },
    sanctum: {
        note: "gilded ritual sanctum",
        floor: "polished dark violet temple flagstones with thin elegant gold inlay lines forming partial geometric ritual patterns, soft lacquered sheen",
        wallTop: "polished near-black violet stone wall tops, large smooth flat blocks, very subtle sheen, quiet and uniform, no inlay, no trim",
        wallFace: "polished dark violet sanctum masonry with slender gold inlay runes set between smooth stone courses, faint warm reflection",
        corridor: "polished dark violet temple paving with a single worn gold guide-line inlay running along the path",
        door: "sanctum threshold slab inlaid with a gold ritual circle seal, polished dark violet stone, faint golden shimmer",
    },
    ruins: {
        note: "overgrown ruin",
        floor: "cracked ancient violet-grey flagstones invaded by soft green-teal moss in the seams and a few tiny pale mushrooms, crumbled slab corners",
        wallTop: "crumbling near-black violet wall tops, chipped blocks with sparse moss tufts in the gaps",
        wallFace: "crumbling violet-grey ruin masonry with missing brick chunks, hanging moss patches and thin creeping roots between weathered courses",
        corridor: "broken dark violet paving with moss filling the cracks and scattered rubble pebbles",
        door: "ruined threshold slab split by a mossy crack, worn engraving barely visible, violet-grey stone with green-teal growth",
    },
};

// ── The batch ────────────────────────────────────────────────────────────────
// key = shared-image id (shrine:<rest>). Existing ids are overwritten on
// publish — the owner asked for a full art replacement.
const ASSETS = [];
function add(name, id, prompt, opts = {}) {
    ASSETS.push({ name, id, prompt, size: opts.size ?? "1024x1024", maxPx: opts.maxPx ?? 256, quality: opts.quality ?? "medium", styleWrap: opts.styleWrap ?? false, transparent: opts.transparent ?? false });
}

// Base terrain (corridors + unthemed fallback). Variant keys -0/-1/-2 exist on
// live from the old atlas slices, so each gets fresh distinct art.
add("base-floor",      "shrine:tile-room-floor",       `${BASE.floor}, ${TILE_RULES}`);
add("base-floor-0",    "shrine:tile-room-floor-0",     `${BASE.floor}, slightly different slab arrangement, ${TILE_RULES}`);
add("base-floor-1",    "shrine:tile-room-floor-1",     `${BASE.floor}, a few smaller broken slabs, ${TILE_RULES}`);
add("base-floor-2",    "shrine:tile-room-floor-2",     `${BASE.floor}, one faint engraved sigil worn almost flat, ${TILE_RULES}`);
add("base-corridor",   "shrine:tile-corridor-floor",   `${BASE.corridor}, ${TILE_RULES}`);
add("base-corridor-0", "shrine:tile-corridor-floor-0", `${BASE.corridor}, slightly different paving layout, ${TILE_RULES}`);
add("base-corridor-1", "shrine:tile-corridor-floor-1", `${BASE.corridor}, a shallow worn drainage groove along one side, ${TILE_RULES}`);
add("base-wall",       "shrine:tile-wall",             `${BASE.wallTop}, ${TILE_RULES}`);
add("base-wall-0",     "shrine:tile-wall-0",           `${BASE.wallTop}, slightly different block layout, ${TILE_RULES}`);
add("base-wall-1",     "shrine:tile-wall-1",           `${BASE.wallTop}, one hairline crack across a block, ${TILE_RULES}`);
add("base-wall-2",     "shrine:tile-wall-2",           `${BASE.wallTop}, faint violet mineral vein in one block, ${TILE_RULES}`);
add("base-wall-face",  "shrine:tile-wall-face",        `${BASE.wallFace}, ${FACE_RULES}`);
add("base-door",       "shrine:tile-door",             `${BASE.door}, ${TILE_RULES}`);

for (const [theme, t] of Object.entries(THEMES)) {
    add(`${theme}-floor`,     `shrine:icon-theme-${theme}-floor`,     `${t.floor}, part of a ${t.note}, ${TILE_RULES}`);
    add(`${theme}-wall`,      `shrine:icon-theme-${theme}-wall`,      `${t.wallTop}, part of a ${t.note}, ${TILE_RULES}`);
    add(`${theme}-wall-face`, `shrine:icon-theme-${theme}-wall-face`, `${t.wallFace}, part of a ${t.note}, ${FACE_RULES}`);
    add(`${theme}-corridor`,  `shrine:icon-theme-${theme}-corridor`,  `${t.corridor}, part of a ${t.note}, ${TILE_RULES}`);
    add(`${theme}-door`,      `shrine:icon-theme-${theme}-door`,      `${t.door}, part of a ${t.note}, ${TILE_RULES}`);
}

// Key-art backdrop behind the dungeon card (kept painterly — style wrapper ON).
add("backdrop", "shrine:hollow-gate-background",
    "vast subterranean shrine cavern seen from a high vantage: a colossal ancient torii gate of black stone wreathed in violet miasma, broken stairs descending into darkness, faint teal spirit-lanterns, purple chakra mist pooling between ruined pillars, moody and atmospheric, wide establishing shot",
    { size: "1536x1024", maxPx: 1024, quality: "medium", styleWrap: true });

// ── Floor decorations (transparent sprites overlaid on floors) ───────────────
// These REPLACE the mismatched clutter (random waterfalls / fountains / shields
// that read wrong in a shadow shrine). Each is a single small prop on a clean
// transparent background, top-down-ish, so it sits believably on a floor tile.
// Shared decoration rules — no waterfalls, no fountains, no plants-out-of-place.
const DECO_RULES = "single small dungeon prop object, top-down three-quarter view, sitting on the ground, transparent background, no floor tile beneath it, no scene, no border, no shadow baked in far from the base, muted violet-and-stone shadow-shrine palette, subtle rim light, cohesive with an ancient cursed shinobi shrine, no text, no watermark, no waterfall, no fountain, no shield, no modern objects";

// Base pool (shrine:icon-deco-1..8) — theme-neutral shrine clutter, used
// anywhere a room's theme has no dedicated deco.
const BASE_DECOS = [
    "a cracked ancient stone offering urn, faint violet dust settling around its rim",
    "a small pile of pale weathered bones with a single cracked skull",
    "the broken stump of a carved stone pillar, chipped and cracked",
    "a spirit lantern of dark iron holding a floating violet flame",
    "a cluster of half-melted black ritual candles with small violet flames",
    "a carved circular floor rune-slab glowing faint violet",
    "a heap of shattered stone rubble and shrine debris",
    "a shallow stone offering bowl cradling a single violet ember",
];
BASE_DECOS.forEach((p, i) => add(`deco-${i + 1}`, `shrine:icon-deco-${i + 1}`, `${p}, ${DECO_RULES}`, { transparent: true }));

// Per-theme decorations (2 each) — preferred in a room stamped with that theme,
// so themed rooms feel cohesive (Crypt bones, Ember braziers, etc.).
const THEME_DECOS = {
    crypt:   ["a stacked ossuary of neatly piled pale bones", "a mossless pile of cracked skulls draped in grey cobweb"],
    ember:   ["a squat iron brazier heaped with glowing orange embers and drifting sparks", "a jagged crack in the floor venting smouldering orange coals"],
    sanctum: ["a golden filigree incense burner trailing thin violet smoke", "a tall bronze candle-stand holding a warm steady flame"],
    ruins:   ["a toppled mossy stone pillar wrapped in creeping roots", "a rubble heap overtaken by green-teal moss with a thin pale sapling"],
};
for (const [theme, decos] of Object.entries(THEME_DECOS)) {
    decos.forEach((p, i) => add(`${theme}-deco-${i + 1}`, `shrine:icon-theme-${theme}-deco-${i + 1}`, `${p}, part of a cursed shrine, ${DECO_RULES}`, { transparent: true }));
}

// ── Engine (mirrors gen-asset.mjs) ───────────────────────────────────────────
function styleWrap(prompt, label) {
    return `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
}

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
        console.log(`${exists ? "[have]" : "[gen ]"} ${a.name.padEnd(18)} ${a.id.padEnd(38)} ${a.size} q=${a.quality} max=${a.maxPx}px`);
    }
    console.log(`\n${queue.length} assets · ${queue.filter(a => !fs.existsSync(outFileFor(a))).length} to generate`);
    process.exit(0);
}

const apiKey = envValue("OPENAI_API_KEY");
if (!apiKey) { console.error("error: OPENAI_API_KEY not found (env / .env / main-checkout .env)."); process.exit(1); }

async function generateOne(asset) {
    const outFile = outFileFor(asset);
    if (!flags.force && fs.existsSync(outFile)) return { asset, status: "cached" };
    const finalPrompt = asset.styleWrap ? styleWrap(asset.prompt, asset.id) : asset.prompt;
    // This offline generator intentionally sends its curated prompt and configured API credential to OpenAI.
    // codeql[js/file-access-to-http]
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "gpt-image-1", prompt: finalPrompt, size: asset.size, quality: asset.quality, n: 1,
            // Transparent-background props (decorations) — PNG carries the alpha;
            // sharp keeps it through the WebP encode (WebP supports alpha).
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
    // PNG preview (image tools often can't open webp) + reproducibility sidecar.
    await sharp(webp).png().toFile(outFile.replace(/\.webp$/, ".preview.png"));
    fs.writeFileSync(outFile.replace(/\.webp$/, ".txt"), `${asset.id}\n\n${asset.prompt}\n`);
    return { asset, status: `generated ${(webp.length / 1024).toFixed(0)}KB` };
}

async function publishOne(asset, server, adminPw) {
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
