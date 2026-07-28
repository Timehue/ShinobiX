// Card-pack wrapper art for the pack-opening cinematic (CardPackOpening.tsx).
// One full-bleed vertical illustration per storefront pack tier. Writes REPO
// files (not shared:img):
//
//   shinobij.client/public/chronicle/packs/<tier>.webp   (640w, wired via
//   --pack-art in styles/card-pack-opening.css / lib/card-pack-reveal.ts)
//
// Run from repo root:  node scripts/gen-pack-art.mjs [--dry-run] [--force]
//
// OPENAI_API_KEY resolves from env, this worktree's shinobij.client/.env, or
// the MAIN checkout's shinobij.client/.env (keys are untracked on purpose).
// Idempotent: existing output files are skipped unless --force.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLIENT = path.join(ROOT, "shinobij.client");
const OUT_DIR = path.join(CLIENT, "public", "chronicle", "packs");

function resolveKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
    for (const envPath of [
        path.join(CLIENT, ".env"),
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

// Same style wrapper the other asset batches use, so the wrappers match the
// game's art direction. "no text / no logos" is load-bearing here: the pack
// component overlays its own wordmark and ribbon on top of this art.
function styleWrap(prompt, label) {
    return `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
}

// The pack component overlays its wordmark across the top ~20% of the art, so
// heads and faces must sit strictly in the vertical middle band.
const WRAPPER_BASE =
    "vertical trading-card booster pack wrapper illustration, full-bleed painterly anime key art, " +
    "the character's head and face positioned in the vertical CENTER of the frame — the entire top " +
    "quarter of the image is only empty atmospheric sky with no character parts in it, " +
    "quieter breathing room at the bottom edge, rich color depth that still reads at thumbnail size";

const PACKS = [
    {
        tier: "standard",
        prompt:
            `a young shinobi mid-leap through drifting paper talismans and spinning kunai, trailing ribbons of luminous teal chakra, deep slate-blue night sky with a crescent moon and mist-wrapped rooftops far below, glowing teal particles, ${WRAPPER_BASE}`,
    },
    {
        tier: "elite",
        prompt:
            `a masked elite shinobi weaving hand seals inside a blazing violet jutsu circle, arcs of purple lightning and floating glowing sigils orbiting upward, dark plum storm clouds behind, luminous magenta embers, ${WRAPPER_BASE}`,
    },
    {
        tier: "legendary",
        prompt:
            `a legendary warlord silhouetted before a colossal golden dragon of pure chakra coiling into black storm clouds, radiant gold god-rays breaking through, drifting embers and gold-leaf motes, ${WRAPPER_BASE}`,
    },
];

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] ?? "").split(",") : null;
const key = resolveKey();
if (!key && !dryRun) {
    console.error("[gen-pack-art] No OPENAI_API_KEY found (env or shinobij.client/.env).");
    process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const jobs = PACKS.filter((p) => (only ? only.includes(p.tier) : true))
    .filter((p) => force || only || !fs.existsSync(path.join(OUT_DIR, `${p.tier}.webp`)));
console.log(`[gen-pack-art] ${jobs.length} of ${PACKS.length} wrappers to generate.`);
if (dryRun) {
    for (const j of jobs) console.log(`  [dry] ${j.tier}`);
    process.exit(0);
}

for (const job of jobs) {
    const out = path.join(OUT_DIR, `${job.tier}.webp`);
    console.log(`[gen-pack-art] generating ${job.tier}…`);
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: "gpt-image-1",
            prompt: styleWrap(job.prompt, `card-pack-wrapper:${job.tier}`),
            size: "1024x1536",
            quality: "high",
            n: 1,
        }),
    });
    if (!res.ok) throw new Error(`${job.tier}: HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${job.tier}: no image in response`);
    const { default: sharp } = await import("sharp");
    await sharp(Buffer.from(b64, "base64"))
        .resize({ width: 640, height: 960, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(out);
    console.log(`[gen-pack-art] wrote ${path.relative(ROOT, out)} (${fs.statSync(out).size} B)`);
}
console.log("[gen-pack-art] done.");
