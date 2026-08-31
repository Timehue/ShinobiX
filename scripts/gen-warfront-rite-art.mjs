// Hollow Warfront (the Rite) mode art.
//
// The lobby still advertised the RETIRED three-lane battlefield — key art and a
// mode card showing lanes and Ward Towers for a mode that no longer has either.
// These replace them with the Rite's actual fantasy: two four-pet bands facing
// each other across one sealed ring.
//
// Composition constraints are real, not decorative:
//   - KEYART is a wide lobby banner. Creatures are allowed here (it is the one
//     asset that should show a clash), but it must stay readable behind an
//     overlaid title, so the centre is deliberately uncluttered.
//   - CARD is a small square activity tile, seen at ~64px. It must read as ONE
//     silhouette at thumbnail size, so it is an emblem, not a scene.
//   - FLOOR maps onto the arena's flat circle in the 3D stage, so it must be a
//     top-down radial composition with a centred sigil and NO creatures.
//
// OPENAI_API_KEY resolves from env or the worktree/main shinobij.client/.env.
// Idempotent: existing outputs are skipped, so it resumes after a failure.
//
// Run from repo root:
//   node scripts/gen-warfront-rite-art.mjs [--dry-run] [--only floor] [--quality medium]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "shinobij.client", "src", "assets", "warfront-rite");

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

// The mode's palette, stated so every asset lands in the same world as the 3D
// stage: a void-black arena lit by ward cyan, with azure and crimson bands.
const PALETTE = "Colour: deep void black and cold slate blue ground, lit by glowing WARD CYAN (#6fd7ef) seals and rings. One side reads AZURE (#4cc9f0), the other CRIMSON (#ff5470). Dramatic rim lighting, cinematic contrast, rich saturation.";

function styleWrap(prompt, label, extra = "") {
    return `Create a polished 2D anime fantasy RPG asset for a browser game about shinobi creature battles. High-detail painterly digital concept art, dramatic cinematic lighting, clean readable composition.\n\nScene:\n${prompt}\n\n${PALETTE}\n\nAsset label:\n${label}\n\nHard rules:\n- no text, no letters, no numbers, no runic writing except a single abstract sigil where specified\n- no logos, no UI elements, no watermarks, no borders, no picture frame\n- no humans, no ninja people — this world's fighters are CREATURES\n${extra}`;
}

const JOBS = [
    {
        key: "keyart",
        label: "Hollow Warfront — the Rite, lobby key art",
        out: path.join(OUT_DIR, "warfront-rite-keyart.webp"),
        size: "1536x1024",
        maxPx: 1280,
        prompt: [
            "A wide cinematic banner of THE RITE: one circular sealed arena floating in a black void, seen from a low dramatic three-quarter angle.",
            "Two bands of four fantasy creatures face each other across the ring — a stylised azure-lit band on the left, a crimson-lit band on the right.",
            "The creatures are anime fantasy beasts (foxes, armoured tortoises, crystal golems, horned wolves), mid-stride, about to meet in the centre.",
            "Glowing concentric ward rings are etched into the arena floor beneath them, and a soft cyan seal burns at the exact centre of the ring.",
            "Sparks and drifting embers fill the air. The upper-centre of the frame is OPEN SKY and empty void so a title can be overlaid there.",
        ].join(" "),
        extra: "- keep the CENTRE-TOP third of the image visually quiet and uncluttered for an overlaid title\n- creatures must be silhouetted clearly against the dark background",
    },
    {
        key: "card",
        label: "Hollow Warfront — the Rite, mode card emblem",
        out: path.join(OUT_DIR, "warfront-rite-card.webp"),
        size: "1024x1024",
        maxPx: 512,
        prompt: [
            "A bold square EMBLEM for a creature-battle game mode, readable as one shape at thumbnail size.",
            "A single circular arena seal viewed straight on, drawn as concentric glowing cyan rings.",
            "Two abstract creature silhouettes face each other across the seal — one azure, one crimson — reduced to strong simple shapes, filling the frame.",
            "Heavy rim light, deep black background, high contrast, poster-like graphic clarity.",
        ].join(" "),
        extra: "- MUST read clearly when shrunk to 64 by 64 pixels: bold shapes, few details, strong silhouette\n- centred composition with generous margin around the emblem",
    },
    {
        key: "floor",
        label: "Hollow Warfront — the Rite, arena floor",
        out: path.join(OUT_DIR, "warfront-rite-floor.webp"),
        size: "1024x1024",
        maxPx: 1024,
        prompt: [
            "Straight-down aerial bird's-eye view (top-down orthographic) of a circular battle-arena floor that fills the square frame.",
            "Perfectly centred and radially symmetric: dark polished slate stone with concentric glowing cyan ward rings inscribed into it.",
            "A single abstract glowing sigil sits at the EXACT centre. Fine cracks and scorch marks radiate outward from it.",
            "The outer edge fades into black void — the arena is a platform suspended in nothing.",
        ].join(" "),
        extra: "- absolutely NO creatures, NO characters, NO animals — the floor is EMPTY and ready for fighters to be composited on top\n- must be radially symmetric so it maps onto a flat circle without a visible seam",
    },
];

async function generate(job, key, quality) {
    // This offline generator intentionally sends its curated prompt and configured API credential to OpenAI.
    // codeql[js/file-access-to-http]
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: "gpt-image-1",
            prompt: styleWrap(job.prompt, job.label, job.extra),
            size: job.size,
            quality,
            n: 1,
        }),
    });
    if (!res.ok) throw new Error(`${job.label}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${job.label}: no image in response`);
    const { default: sharp } = await import("sharp");
    const buf = Buffer.from(b64, "base64");
    await sharp(buf)
        .resize({ width: job.maxPx, height: job.maxPx, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(job.out);
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
    const quality = args.includes("--quality") ? args[args.indexOf("--quality") + 1] : "high";
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const jobs = JOBS
        .filter((job) => !only || job.key === only)
        .filter((job) => !fs.existsSync(job.out));
    console.log(`${jobs.length} job(s) to generate (quality=${quality}):`);
    for (const job of jobs) console.log(`  ${job.label} → ${path.relative(ROOT, job.out)}`);
    if (dryRun || jobs.length === 0) {
        if (!jobs.length) console.log("(nothing to do — all exist)");
        return;
    }

    const key = resolveKey();
    if (!key) { console.error("No OPENAI_API_KEY found (env or shinobij.client/.env)."); process.exit(1); }

    let done = 0;
    let failed = 0;
    for (const job of jobs) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await generate(job, key, quality);
                done++;
                console.log(`ok  (${done + failed}/${jobs.length}) ${job.label}`);
                break;
            } catch (err) {
                if (attempt === 3) { failed++; console.error(`FAIL ${job.label}: ${String(err).slice(0, 240)}`); }
                else await new Promise((r) => setTimeout(r, 5000 * attempt));
            }
        }
    }
    console.log(`\nDone: ${done} ok, ${failed} failed (re-run to retry — existing files are skipped).`);
    if (failed) process.exitCode = 1;
}
main();
