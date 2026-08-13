// Pet Showdown epic VFX art batch — the "Pokémon Champions scale" round.
// Generates large PAINTED single-sprite textures (not flipbook frames) that the
// Showdown set-piece layer renders as billboards/floor discs:
//
//   shinobij.client/src/assets/fx/epic/<slug>.webp   (alpha-preserving WebP)
//
// Three kinds of sprite:
//   - structures: full-frame element walls/columns (tsunami, firewall, tornado,
//     quake spires, storm bolt) — transparent background, billboarded in-scene.
//   - floors: circular "the arena floor becomes the element" discs, viewed from
//     directly above — laid flat under the fighters during super moves.
//   - crowd: one painted spectator band for the arena bowl wall.
//
// Run from repo root:  node --import tsx scripts/gen-showdown-vfx.mjs [--only tsunami] [--dry-run] [--force]
//
// OPENAI_API_KEY resolves from env, this worktree's shinobij.client/.env, or the
// MAIN checkout's shinobij.client/.env (keys are untracked there on purpose).
// Idempotent: existing output files are skipped unless --force.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLIENT = path.join(ROOT, "shinobij.client");
const OUT_DIR = path.join(CLIENT, "src", "assets", "fx", "epic");

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

function styleWrap(prompt) {
    return `Create a AAA-quality painted game VFX sprite for a turn-based monster-battling RPG (the visual register of a Pokémon signature-move cinematic).

User request:
${prompt}

Style rules:
- painted anime VFX, crisp silhouettes, dramatic value range
- this is an isolated EFFECT SPRITE, not a scene: no characters, no creatures, no arena, no ground plane, no sky, no horizon (unless the request explicitly says otherwise)
- no text, no logos, no UI, no watermarks
- rich internal glow and translucency where the element calls for it
- composition fills the canvas edge-to-edge where the request says "full width" or "full height"`;
}

// wide = 1536x1024, tall = 1024x1536, square = 1024x1024
const JOBS = [
    // — structures (transparent billboards) —
    {
        slug: "tsunami", kind: "structure", size: "1536x1024", quality: "high", transparent: true,
        prompt: "colossal towering tsunami wave wall for a water-type super move, deep teal-blue translucent water curling over at the crest with brilliant white churning foam and flying spray, glowing aqua backlight inside the wave body, side-on view, the wave spans the full width of the canvas and curls toward the viewer's right, fully transparent background outside the water",
    },
    {
        slug: "firewall", kind: "structure", size: "1536x1024", quality: "high", transparent: true,
        prompt: "roaring wall of flame for a fire-type super move, towering orange-and-crimson fire tongues with a blinding yellow-white core, licks of flame whipping upward and drifting embers, side-on view, the fire wall spans the full width of the canvas, fully transparent background outside the flames",
    },
    {
        slug: "tornado", kind: "structure", size: "1024x1536", quality: "high", transparent: true,
        prompt: "single massive tornado column for a wind-type super move, pale silver and seafoam-green swirling funnel with layered spiral wind bands, ragged vapor streamers and a flared debris skirt at the base, the column fills the full height of the canvas, fully transparent background outside the funnel",
    },
    {
        slug: "quake", kind: "structure", size: "1536x1024", quality: "high", transparent: true,
        prompt: "cluster of jagged granite stone spires erupting upward for an earth-type super move, sharp angular rock shards thrusting up at aggressive angles with glowing amber fracture lines, bursts of dust and tumbling rubble around the bases, spans the full width of the canvas, fully transparent background outside the rock and dust",
    },
    {
        slug: "stormbolt", kind: "structure", size: "1024x1536", quality: "high", transparent: true,
        prompt: "colossal forked lightning bolt for a lightning-type super move, blinding white-violet core stroke with branching electric-blue arcs and crackling sparks, vertical strike filling the full height of the canvas, faint air-distortion glow hugging the bolt, fully transparent background",
    },
    // — floor takeovers (flat discs, viewed from directly above) —
    {
        slug: "floor-water", kind: "floor", size: "1024x1024", quality: "medium", transparent: true,
        prompt: "circular pool of churning ocean surface viewed from directly above, deep blue-teal water with swirling white foam ribbons and concentric ripples, the circle's edge dissolves into fine spray, fully transparent background outside the circle",
    },
    {
        slug: "floor-lava", kind: "floor", size: "1024x1024", quality: "medium", transparent: true,
        prompt: "circular field of cracked volcanic ground viewed from directly above, black basalt plates split by branching glowing orange-red magma veins radiating from the center, scattered embers, the circle's edge fades out softly, fully transparent background outside the circle",
    },
    {
        slug: "floor-wind", kind: "floor", size: "1024x1024", quality: "medium", transparent: true,
        prompt: "circular swirling gale viewed from directly above, pale silver-white spiral wind streaks and a few scattered green leaves rotating around the center like a flattened cyclone, the circle's edge feathers into wisps, fully transparent background outside the circle",
    },
    {
        slug: "floor-earth", kind: "floor", size: "1024x1024", quality: "medium", transparent: true,
        prompt: "circular slab of fractured stone ground viewed from directly above, radial cracks spreading from the center with dust puffs and small floating pebbles, warm sandy browns and slate grays, the circle's edge crumbles and fades out, fully transparent background outside the circle",
    },
    {
        slug: "floor-storm", kind: "floor", size: "1024x1024", quality: "medium", transparent: true,
        prompt: "circular storm-charged ground viewed from directly above, dark slate surface webbed with crackling electric blue-white arcs radiating from the center, faint violet glow pooling in the middle, the circle's edge fades out, fully transparent background outside the circle",
    },
];

// — full arena backdrops with the crowd PAINTED IN (no composite band) —
// These wrap the showdown bowl cylinder (r19, BackSide, MirroredRepeat ×2.5),
// so each must read as a frieze: even repeating rhythm, no single landmark,
// eye-level in the lower third. Written to assets/coliseum/<stage>-bg-crowd.webp
// and wired via STAGES in PetShowdownBattle only — legacy screens keep the old art.
const ARENA_COMPOSITION = "interior wall of a colossal fantasy battle arena seen from the arena floor at its center, lower third is a carved barrier wall below the stands, middle band is three packed tiers of tiny cheering anime spectators painted at soft distance focus so no single face draws the eye, upper portion rises into the arena's architecture, even repeating rhythm of pillars and stands with no single unique landmark so the panorama tiles seamlessly, wide panoramic frieze composition filling the full canvas";
const ARENA_JOBS = [
    {
        slug: "arena-coliseum", kind: "arena", size: "1536x1024", quality: "high",
        prompt: `${ARENA_COMPOSITION}, warm sandstone and vermilion-lacquered wood, strings of glowing paper lanterns between the tiers, festival banners, golden-hour light, distant warm haze`,
    },
    {
        slug: "arena-grove", kind: "arena", size: "1536x1024", quality: "high",
        prompt: `${ARENA_COMPOSITION}, stands grown from living wood and moss-covered stone, a canopy of glowing green leaves above, drifting spores of light, dappled emerald forest light`,
    },
    {
        slug: "arena-frost", kind: "arena", size: "1536x1024", quality: "high",
        prompt: `${ARENA_COMPOSITION}, tiers carved from blue glacier ice and pale stone, spectators bundled in furs, frost-blue lantern glow, aurora light playing over the upper wall, cold crystalline air`,
    },
    {
        slug: "arena-storm", kind: "arena", size: "1536x1024", quality: "high",
        prompt: `${ARENA_COMPOSITION}, dark iron and slate tiers under a boiling violet storm sky, the crowd lit by flickers of distant lightning, storm-lantern glow in amber against the gloom`,
    },
    {
        slug: "arena-volcano", kind: "arena", size: "1536x1024", quality: "high",
        prompt: `${ARENA_COMPOSITION}, tiers of black obsidian and scorched bronze, rivers of ember glow in the wall seams, the crowd silhouetted against deep red volcanic light, drifting embers in the air`,
    },
];

const ARENA_DIR = path.join(CLIENT, "src", "assets", "coliseum");

/** Arena backdrops are scenes, not sprites — skip the isolated-effect rules. */
function arenaWrap(prompt) {
    return `Create a AAA-quality painted game arena backdrop for a turn-based monster-battling RPG (the visual register of a Pokémon Champions stadium).\n\nUser request:\n${prompt}\n\nStyle rules:\n- painted anime environment art, dramatic value range, rich lighting\n- no text, no logos, no UI, no watermarks\n- no foreground creatures or protagonists — the crowd is distant scenery only`;
}

function outPathOf(job) {
    return job.kind === "arena"
        ? path.join(ARENA_DIR, `${job.slug.replace(/^arena-/, "")}-bg-crowd.webp`)
        : path.join(OUT_DIR, `${job.slug}.webp`);
}

async function generate(job, key) {
    // This offline generator intentionally sends its curated prompt and configured API credential to OpenAI.
    // codeql[js/file-access-to-http]
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: "gpt-image-1",
            prompt: job.kind === "arena" ? arenaWrap(job.prompt) : styleWrap(job.prompt),
            size: job.size,
            quality: job.quality,
            n: 1,
            ...(job.transparent ? { background: "transparent", output_format: "png" } : {}),
        }),
    });
    if (!res.ok) throw new Error(`${job.slug}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${job.slug}: no image in response`);
    const { default: sharp } = await import("sharp");
    const buf = Buffer.from(b64, "base64");
    // Keep native resolution — these are hero sprites. WebP preserves alpha.
    await sharp(buf).webp({ quality: 88 }).toFile(outPathOf(job));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";

    fs.mkdirSync(OUT_DIR, { recursive: true });
    let jobs = [...JOBS, ...ARENA_JOBS];
    if (only) jobs = jobs.filter((j) => j.slug.includes(only));
    if (!force) jobs = jobs.filter((j) => !fs.existsSync(outPathOf(j)));

    console.log(`${jobs.length} job(s):`);
    for (const j of jobs) console.log(`  [${j.kind}] ${j.slug} ${j.size} (${j.quality})`);
    if (dryRun || jobs.length === 0) return;

    const key = resolveKey();
    if (!key) { console.error("No OPENAI_API_KEY found."); process.exit(1); }

    let done = 0, failed = 0;
    const queue = [...jobs];
    async function worker() {
        while (queue.length) {
            const job = queue.shift();
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await generate(job, key);
                    done++;
                    console.log(`ok  (${done + failed}/${jobs.length}) ${job.slug}`);
                    break;
                } catch (err) {
                    if (attempt === 3) { failed++; console.error(`FAIL ${job.slug}: ${String(err).slice(0, 200)}`); }
                    else await new Promise((r) => setTimeout(r, 5000 * attempt));
                }
            }
        }
    }
    await Promise.all(Array.from({ length: 3 }, worker));
    console.log(`done: ${done} ok, ${failed} failed`);
    if (failed) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
