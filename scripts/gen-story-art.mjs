// Story-rebuild art batch: portraits for every VN speaker that lacks one,
// scene backdrops for every interlude + road event, and the four Kage
// hollow-form portraits. Writes REPO files (not shared:img):
//
//   shinobij.client/public/portraits/<speaker-slug>.webp   (512px, the defaultVnPortrait convention)
//   shinobij.client/public/scenes/story/<event-id>.webp    (1024w, wired via event.image)
//
// Run from repo root:  node --import tsx scripts/gen-story-art.mjs [--only harrow] [--dry-run] [--limit N]
//
// OPENAI_API_KEY resolves from env, this worktree's shinobij.client/.env, or the
// MAIN checkout's shinobij.client/.env (keys are untracked there on purpose).
// Idempotent: existing output files are skipped, so it resumes after failures.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storyInterludesByVillage } from "../shinobij.client/src/data/story-interludes.ts";
import { storyRoadEvents } from "../shinobij.client/src/data/story-road-events.ts";
import { storylines } from "../shinobij.client/src/data/storylines.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLIENT = path.join(ROOT, "shinobij.client");
const PORTRAIT_DIR = path.join(CLIENT, "public", "portraits");
const SCENE_DIR = path.join(CLIENT, "public", "scenes", "story");

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

// Matches lib/vn.ts defaultVnPortrait slugging.
const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// The in-app style wrapper (gen-asset.mjs), so this art matches everything else.
function styleWrap(prompt, label) {
    return `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
}

const PORTRAIT_BASE = "character portrait bust, head and shoulders, facing slightly left, neutral dark backdrop, painterly anime style";

// Hand-authored looks for the named story NPCs. Anyone else who slips through
// gets a role-derived fallback.
const PORTRAIT_PROMPTS = {
    "kite-harrow": `strikingly attractive young woman in her early twenties, long PINK hair loosely tied back with a few strands falling over sharp amused eyes, sly confident half-smile, traveling broker's layered road clothes in charcoal and slate with a wide belt hung with small brass ledger charms and tally-sticks, NO village headband or insignia anywhere, ${PORTRAIT_BASE}`,
    "jorun": `weathered old carpenter in his sixties, broad scarred hands dusted with wood shavings, gray stubble and deep kind creases around puzzled eyes, plain work apron over faded village work clothes, warm lamplight, the look of a man remembering something with his hands, ${PORTRAIT_BASE}`,
    "pell-marrow": `wiry courier man with singed hair and a soot-streaked face, road-worn message satchel strap across his chest, nervous urgent expression, ${PORTRAIT_BASE}`,
    "instructor-havek": `broad middle-aged martial arts instructor with a gray-streaked topknot, weathered training gi with a foreign village's trim, patient appraising eyes, arms crossed, ${PORTRAIT_BASE}`,
    "oren-slate": `lean tracker with a hood pushed back, wind-burned face, pale sharp eyes that miss nothing, bone toggles on his coat, a coil of marker cord at his shoulder, ${PORTRAIT_BASE}`,
    "serel": `ageless pilgrim in undyed gray robes worn soft by the road, calm deep-lined face, a plain wooden bowl hanging from a cord at their chest, quiet knowing expression, ${PORTRAIT_BASE}`,
    "sefa": `elderly pilgrim woman with a walking staff, sun-faded shawl over travel robes, kind stubborn face with a fresh cut above one brow, ${PORTRAIT_BASE}`,
    "emissary-corvane": `austere archivist emissary in slate-gray layered robes, silver clasp shaped like an open book, hollow-cheeked scholarly face, eyes like someone who reads witnesses instead of pages, ${PORTRAIT_BASE}`,
    "registrar-corin-vell": `precise middle-aged official with wire-frame spectacles, high-collared registrar's coat with ink-stained cuffs, a stamped ledger held to his chest, tightly controlled worry, ${PORTRAIT_BASE}`,
    "anji-vesk": `young determined shinobi woman with cropped dark hair and a foreign village's headband, training bruises and taped knuckles, jaw set with stubborn resolve, losing streak in her eyes but not surrender, ${PORTRAIT_BASE}`,
    "proctor-hasse": `stern drill proctor in a joint-exercise officer's coat with two villages' cords braided at the shoulder, salt-and-pepper beard, whistle on a lanyard, thunderous disciplined face, ${PORTRAIT_BASE}`,
    "corvo-latch": `oily charming information broker with slicked dark hair, a patchwork coat lined with map tubes and rolled route papers, gold tooth in a salesman's grin, eyes doing arithmetic, ${PORTRAIT_BASE}`,
    "adjutant-denn": `tired mid-ranking adjutant in a crisp uniform one size too formal, decree scroll under one arm, ink smudge on his cheek, the face of a man following orders he has stopped believing, ${PORTRAIT_BASE}`,
    "suma": `warm weathered woman in traveling clothes with a walking pack, gray-streaked braid, open honest face of someone who trusts and has paid for it before, small carved charm at her throat, ${PORTRAIT_BASE}`,
    "amra-tull": `composed village official woman in formal robes with a petition case, careful diplomatic face with exhausted eyes, hair pinned with plain iron pins, ${PORTRAIT_BASE}`,
    "ledger-clerk": `pale arena clerk behind a barred window, green eyeshade, fingerless gloves, quill tucked behind one ear, bored eyes that have written down terrible things neatly, ${PORTRAIT_BASE}`,
    "registry-duty-clerk": `middle-aged registry clerk in ash-grey robes with cedar-toggle fastenings, ink-stained fingers, reading spectacles pushed up into greying hair, dry humor around tired eyes, a bundle of wooden record slats under one arm, ${PORTRAIT_BASE}`,
    "imera": `careworn mother in her thirties, patched homespun apron over work clothes, dark hair pinned back hastily, fierce protective eyes with exhaustion under them, garden-rough hands, ${PORTRAIT_BASE}`,
    "sera-reed": `warm grandmother-aged woman with silver-streaked hair in a neat bun, flour-dusted apron, kind crinkled smiling eyes with something faintly absent behind them, holding a teacup, ${PORTRAIT_BASE}`,
    "kage-raiko-veyr-hollow": `the Hollow Storm Tyrant: a towering Kage consumed by living storm, body crackling apart into lightning and black thunderhead, glowing storm-white eyes, tattered Kage mantle whipping in wind that comes from inside him, terrifying and sorrowful, dramatic low angle, waist-up`,
    "kage-hoshina-enju-hollow": `the First Flame Vessel: a regal Kage woman being worn by living fire, ceremonial robes igniting into slow orange-white flame that moves like fabric, ash falling upward around her, serene expression cracking with inner light, waist-up, dramatic`,
    "kage-kael-whitefang-hollow": `the Hollow Oath Tyrant: a broad Kage man fused into pale glacial ice, oath-mark sigils frozen glowing beneath the surface of his skin and armor, breath of frost, eyes emptied of choice, waist-up, dramatic`,
    "kage-sable-nocturne-hollow": `the Hollow Moon Sovereign: a Kage woman whose face is a shifting overlay of many stolen faces under a cracked porcelain mask held in one hand, robes of layered shadow and moonlight, waist-up, unsettling elegance, dramatic`,
};

// Minor speakers get a role inferred from their name/title instead of a
// generic "an NPC" prompt — one-scene voices still deserve a real face.
const ROLE_HINTS = [
    [/sergeant|private|guard/i, "uniformed village soldier, practical armor, disciplined weathered face"],
    [/captain/i, "veteran officer, command bearing, decorated practical armor, hard fair eyes"],
    [/warden|keeper/i, "solemn keeper of a sealed place, ceremonial half-armor, ritual cords, guarded expression"],
    [/registrar|secretary|clerk|undersecretary/i, "meticulous records official, high-collared coat, ink-stained fingers, careful eyes"],
    [/foreman/i, "burly dig-site foreman, dust-caked work coat, rope over shoulder, uneasy defiance"],
    [/veil|shade/i, "moonshadow information broker, layered dark silks, half-veil, unreadable expression"],
    [/pale-pack|runner/i, "gaunt unsealed refugee runner, patched winter furs, wary hunted eyes"],
    [/elder/i, "village elder, formal robes, deep-lined face, heavy-lidded knowing eyes"],
];
function roleFallback(name) {
    for (const [re, desc] of ROLE_HINTS) if (re.test(name)) return `${name}: ${desc}`;
    return `${name}: a shinobi-world villager met on the road, distinct memorable face, practical travel clothes, expressive eyes`;
}

const VILLAGE_SCENE_FLAVOR = {
    "Stormveil Village": "storm-country shinobi village, charged sky, lightning rods and banner cables, slate and cedar architecture",
    "Ashen Leaf Village": "volcanic-ash shinobi village, warm lantern light, dark timber and ash-grey mortar, drifting ember motes",
    "Frostfang Village": "glacial shinobi village, deep snow and blue ice, steep-roofed lodges, aurora-lit sky",
    "Moonshadow Village": "moonlit canal shinobi village, deep violet night, paper lanterns, mist between close rooftops",
};
const ROAD_SCENE_FLAVOR = "shinobi world countryside between villages, traveled dirt road, dramatic sky";

function collectJobs() {
    const jobs = [];
    const existing = new Set(fs.readdirSync(PORTRAIT_DIR).map((f) => f.toLowerCase()));

    // Portraits: every speaker across chapters + interludes + road events
    // without a file (chapters matter too — new chapter-only speakers like
    // Imera would otherwise ship faceless).
    const speakers = new Map();
    for (const [, steps] of Object.entries(storylines)) {
        for (const s of steps) for (const p of s.pages ?? []) speakers.set(slugify(p.speaker), p.speaker);
    }
    for (const [, entries] of Object.entries(storyInterludesByVillage)) {
        for (const e of entries) for (const p of e.pages) speakers.set(slugify(p.speaker), p.speaker);
    }
    for (const e of storyRoadEvents) {
        speakers.set(slugify(e.npcName), e.npcName);
        for (const p of e.pages) speakers.set(slugify(p.speaker), p.speaker);
    }
    speakers.delete("narrator"); speakers.delete("player"); speakers.delete("");
    for (const [slug, name] of speakers) {
        if (existing.has(`${slug}.webp`)) continue;
        const prompt = PORTRAIT_PROMPTS[slug] ?? `${roleFallback(name)}, ${PORTRAIT_BASE}`;
        jobs.push({ kind: "portrait", slug, label: `portrait:${slug}`, prompt, out: path.join(PORTRAIT_DIR, `${slug}.webp`), size: "1024x1024", quality: slug === "kite-harrow" ? "high" : "medium", maxPx: 512 });
    }

    // Kage hollow forms (always, unless present).
    for (const slug of ["kage-raiko-veyr-hollow", "kage-hoshina-enju-hollow", "kage-kael-whitefang-hollow", "kage-sable-nocturne-hollow"]) {
        if (existing.has(`${slug}.webp`)) continue;
        jobs.push({ kind: "portrait", slug, label: `portrait:${slug}`, prompt: PORTRAIT_PROMPTS[slug], out: path.join(PORTRAIT_DIR, `${slug}.webp`), size: "1024x1024", quality: "high", maxPx: 512 });
    }

    // Scenes: one backdrop per interlude and road event.
    fs.mkdirSync(SCENE_DIR, { recursive: true });
    const sceneExisting = new Set(fs.readdirSync(SCENE_DIR).map((f) => f.toLowerCase()));
    for (const [village, entries] of Object.entries(storyInterludesByVillage)) {
        for (const e of entries) {
            if (sceneExisting.has(`${e.id}.webp`)) continue;
            const caption = e.pages[0]?.scene ?? e.title;
            jobs.push({ kind: "scene", slug: e.id, label: `scene:${e.id}`, prompt: `${caption} — ${VILLAGE_SCENE_FLAVOR[village]}, environment concept art, wide establishing shot, cinematic, absolutely no people or characters`, out: path.join(SCENE_DIR, `${e.id}.webp`), size: "1536x1024", quality: "medium", maxPx: 1024 });
        }
    }
    for (const e of storyRoadEvents) {
        if (sceneExisting.has(`${e.id}.webp`)) continue;
        const caption = e.pages[0]?.scene ?? e.title;
        jobs.push({ kind: "scene", slug: e.id, label: `scene:${e.id}`, prompt: `${caption} — ${ROAD_SCENE_FLAVOR}, environment concept art, wide establishing shot, cinematic, absolutely no people or characters`, out: path.join(SCENE_DIR, `${e.id}.webp`), size: "1536x1024", quality: "medium", maxPx: 1024 });
    }
    // Milestone chapter scenes (ids match the trigger/Story Hall chapterId).
    for (const [village, steps] of Object.entries(storylines)) {
        for (const [index, step] of steps.entries()) {
            const id = `story-${village.toLowerCase().replace(/\W+/g, "-")}-${step.levelReq}-${index}`;
            if (sceneExisting.has(`${id}.webp`)) continue;
            jobs.push({ kind: "scene", slug: id, label: `scene:${id}`, prompt: `${step.scene ?? step.title} — ${VILLAGE_SCENE_FLAVOR[village] ?? ROAD_SCENE_FLAVOR}, environment concept art, wide establishing shot, cinematic, absolutely no people or characters`, out: path.join(SCENE_DIR, `${id}.webp`), size: "1536x1024", quality: "medium", maxPx: 1024 });
        }
    }
    return jobs;
}

async function generate(job, key) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-image-1", prompt: styleWrap(job.prompt, job.label), size: job.size, quality: job.quality, n: 1 }),
    });
    if (!res.ok) throw new Error(`${job.label}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${job.label}: no image in response`);
    const { default: sharp } = await import("sharp");
    const buf = Buffer.from(b64, "base64");
    await sharp(buf).resize({ width: job.maxPx, height: job.maxPx, fit: "inside", withoutEnlargement: true }).webp({ quality: job.kind === "scene" ? 72 : 82 }).toFile(job.out);
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
    const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

    let jobs = collectJobs();
    if (only) jobs = jobs.filter((j) => j.slug.includes(only));
    jobs = jobs.slice(0, limit);
    console.log(`${jobs.length} job(s):`);
    for (const j of jobs) console.log(`  [${j.kind}] ${j.slug} (${j.quality})`);
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
                    console.log(`ok  (${done + failed}/${jobs.length}) ${job.label}`);
                    break;
                } catch (err) {
                    if (attempt === 3) { failed++; console.error(`FAIL ${job.label}: ${String(err).slice(0, 200)}`); }
                    else await new Promise((r) => setTimeout(r, 5000 * attempt));
                }
            }
        }
    }
    await Promise.all([worker(), worker()]);
    console.log(`\nDone: ${done} ok, ${failed} failed (re-run to retry failures — existing files are skipped).`);
    if (failed) process.exitCode = 1;
}

await main();
