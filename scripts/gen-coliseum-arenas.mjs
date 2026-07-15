// Pet Coliseum arena roster art — a themed backdrop + floor pair per element mood,
// so the marquee mode has a real "stadium select" feel instead of one room. Matches
// the existing painterly-anime coliseum-bg.webp / coliseum-floor.webp style + the exact
// composition constraints the renderer needs:
//   - BG wraps around a cylinder arc (MirroredRepeat 2×) → must be bilaterally SYMMETRIC,
//     sky in the upper half, curved tiered stands, NO floor/ground in frame.
//   - FLOOR maps onto a flat circle top-down → must be a centered RADIAL composition with
//     a glowing sigil at the exact center and terrain around the outer edge.
//
// Writes REPO files (bundled assets, not shared:img):
//   shinobij.client/src/assets/coliseum/<theme>-bg.webp     (1280px)
//   shinobij.client/src/assets/coliseum/<theme>-floor.webp  (1024px)
//
// OPENAI_API_KEY resolves from env or the worktree/main shinobij.client/.env (untracked).
// Idempotent: existing output files are skipped, so it resumes after failures.
//
// Run from repo root:
//   node scripts/gen-coliseum-arenas.mjs [--dry-run] [--only frost] [--quality medium]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "shinobij.client", "src", "assets", "coliseum");

function resolveKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
    for (const envPath of [
        path.join(ROOT, "shinobij.client", ".env"),
        "C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/.env",
    ]) {
        if (!fs.existsSync(envPath)) continue;
        for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
            const m = line.match(/^OPENAI_API_KEY\s*=\s*(.+)$/);
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

function styleWrap(prompt, label) {
    return `Create a polished 2D anime fantasy RPG battle-arena environment asset for a browser game. High-detail painterly digital concept art, dramatic cinematic lighting, rich saturated color, clean readable composition.\n\nScene:\n${prompt}\n\nAsset label:\n${label}\n\nHard rules:\n- absolutely NO people, NO characters, NO creatures, NO animals\n- no text, no letters, no runic writing except the single central sigil where specified\n- no logos, no UI, no watermarks, no borders, no frame\n- the environment is EMPTY and ready for fighters to be composited on top`;
}

// Composition boilerplate shared by every backdrop / floor so they all wrap + map right.
const BG_COMP = "Viewed from the very center of the round arena pit looking up and outward. The curved tiered coliseum wall wraps in a wide arc across the whole frame and is PERFECTLY BILATERALLY SYMMETRIC (left half mirrors the right). The dramatic sky fills the entire upper half of the image. The arena floor is NOT visible — do not draw any ground, pit floor, or foreground.";
const FLOOR_COMP = "Straight-down aerial bird's-eye view (top-down orthographic) of a circular battle-arena floor that fills the square frame. Perfectly centered and radially symmetric, concentric rings. A single glowing sigil sits at the EXACT center.";

const ARENAS = {
    frost: {
        bg: `A grand circular coliseum of pale blue-white frost-stone at night. ${BG_COMP} Curved tiered stands of ice-glazed blue stone hung with long icicles and glowing pale-cyan paper lanterns. A shimmering green-and-violet aurora and a large luminous moon fill the sky, gentle snowfall drifting down, cold crystalline moonlight.`,
        floor: `A frozen arena floor of cracked pale-blue ice and snow-dusted grey flagstones in concentric rings. ${FLOOR_COMP} A glowing cyan frost-rune sigil at the exact center. Snow drifts and small jagged ice shards ring the outer edge. Cold blue under-lighting.`,
    },
    volcano: {
        bg: `A massive volcanic coliseum carved from black obsidian. ${BG_COMP} Curved tiered stands of dark volcanic rock veined with glowing molten-orange lava seams, roaring iron fire-braziers along the tiers. A churning ash-grey and ember-orange sky with drifting sparks and a deep red volcanic glow fills the upper half. Intense dramatic firelight.`,
        floor: `An arena floor of cracked black obsidian shot through with glowing orange lava veins in concentric rings. ${FLOOR_COMP} A molten fire-rune sigil at the exact center. Scorched stone rubble and glowing embers ring the outer edge. Intense orange under-glow.`,
    },
    grove: {
        bg: `An ancient overgrown stone amphitheater reclaimed by a lush forest. ${BG_COMP} Curved mossy tiered stands wrapped in thick green vines and blooming flowers, weathered carved pillars, hanging soft-green paper lanterns. Golden sunbeams stream down through a dense emerald forest canopy that fills the upper half. Warm dappled daylight.`,
        floor: `An arena floor of moss-covered grey flagstones in concentric rings, cracks sprouting grass. ${FLOOR_COMP} A glowing green leaf-rune sigil at the exact center. Ferns, tufts of grass, and gnarled roots ring the outer edge. Warm green dappled light.`,
    },
    storm: {
        bg: `A towering dark-slate coliseum high above the clouds in a raging thunderstorm. ${BG_COMP} Curved rain-slick tiered stands of dark stone lined with glowing blue-white lanterns and crackling arcane energy conduits. A violet-black storm sky torn by forking white lightning bolts fills the upper half, sheets of rain, dramatic backlight.`,
        floor: `An arena floor of dark wet slate stone in concentric rings, gleaming with rain. ${FLOOR_COMP} A crackling blue-white lightning-rune sigil at the exact center. Shallow rippling puddles and small electric sparks ring the outer edge. Cool blue-violet lighting.`,
    },
};

function collectJobs(only) {
    const jobs = [];
    for (const [theme, defs] of Object.entries(ARENAS)) {
        if (only && theme !== only) continue;
        jobs.push({ theme, kind: "bg", label: `arena:${theme}:bg`, prompt: defs.bg, size: "1536x1024", maxPx: 1280, out: path.join(OUT_DIR, `${theme}-bg.webp`) });
        jobs.push({ theme, kind: "floor", label: `arena:${theme}:floor`, prompt: defs.floor, size: "1024x1024", maxPx: 1024, out: path.join(OUT_DIR, `${theme}-floor.webp`) });
    }
    return jobs;
}

async function generate(job, key, quality) {
    // This offline generator intentionally sends its curated prompt and configured API credential to OpenAI.
    // codeql[js/file-access-to-http]
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-image-1", prompt: styleWrap(job.prompt, job.label), size: job.size, quality, n: 1 }),
    });
    if (!res.ok) throw new Error(`${job.label}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${job.label}: no image in response`);
    const { default: sharp } = await import("sharp");
    const buf = Buffer.from(b64, "base64");
    await sharp(buf).resize({ width: job.maxPx, height: job.maxPx, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(job.out);
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
    const quality = args.includes("--quality") ? args[args.indexOf("--quality") + 1] : "high";
    fs.mkdirSync(OUT_DIR, { recursive: true });

    let jobs = collectJobs(only).filter((j) => !fs.existsSync(j.out));
    console.log(`${jobs.length} job(s) to generate (quality=${quality}):`);
    for (const j of jobs) console.log(`  ${j.label} → ${path.relative(ROOT, j.out)}`);
    if (dryRun || jobs.length === 0) { if (!jobs.length) console.log("(nothing to do — all exist)"); return; }

    const key = resolveKey();
    if (!key) { console.error("No OPENAI_API_KEY found (env or shinobij.client/.env)."); process.exit(1); }

    let done = 0, failed = 0;
    const queue = [...jobs];
    async function worker() {
        while (queue.length) {
            const job = queue.shift();
            for (let attempt = 1; attempt <= 3; attempt++) {
                try { await generate(job, key, quality); done++; console.log(`ok  (${done + failed}/${jobs.length}) ${job.label}`); break; }
                catch (err) {
                    if (attempt === 3) { failed++; console.error(`FAIL ${job.label}: ${String(err).slice(0, 200)}`); }
                    else await new Promise((r) => setTimeout(r, 5000 * attempt));
                }
            }
        }
    }
    await Promise.all([worker(), worker()]);
    console.log(`\nDone: ${done} ok, ${failed} failed (re-run to retry — existing files are skipped).`);
    if (failed) process.exitCode = 1;
}
main();
