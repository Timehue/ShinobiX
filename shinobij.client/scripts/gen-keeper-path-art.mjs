// Authors the Keeper's Path art: the three Path Keeper duelist portraits and the
// run's hero banner. Each is an EDIT against existing Chronicle art, used only
// as the style reference, so the run sits beside the house Chronicle Keeper
// (public/chronicle/keeper.webp) and the Echoes of War scenes.
//
//   node scripts/gen-keeper-path-art.mjs [--only warden|sentinel|arbiter|hero] [--model gpt-image-2] [--env-file <path>] [--dry-run]
//
// Writes raw PNGs to scripts/.keeper-path-art/ (gitignored scratch), then
// shrinks them to the shipped WebPs in public/chronicle/:
//   path-warden.webp, path-sentinel.webp, path-arbiter.webp  (512x512)
//   keeper-path-hero.webp                                     (1536x640)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes("--" + n);

function envKey(name, file) {
    if (process.env[name]) return process.env[name].trim();
    for (const p of [file, path.join(CLIENT, ".env")].filter(Boolean)) {
        if (!fs.existsSync(p)) continue;
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
            const m = line.match(new RegExp("^" + name + "\\s*=\\s*(.+)$"));
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

const PORTRAIT_STYLE = [
    "The attached portrait is the house Chronicle Keeper of a shinobi card-duel game. Use it ONLY as the reference for",
    "art style, palette, lighting and rendering. Do not copy its mask, face or hood.",
    "",
    "Paint ONE new character portrait in exactly that style: AAA hand-painted dark fantasy realism, a hooded masked",
    "keeper shown head and shoulders, centred, facing the viewer, in deep shadow against a near-black background,",
    "lit by one warm source, with a few paper talismans bearing faint ink seals drifting around the head and thin",
    "cool spirit wisps at the edges. Square framing, the face in the upper middle third.",
    "",
    "No text, no letters, no numbers, no logo, no watermark, no frame, no border.",
].join("\n");

const JOBS = {
    warden: {
        ref: "public/chronicle/keeper.webp", size: "1024x1024", out: "public/chronicle/path-warden.webp", width: 512, height: 512,
        prompt: [PORTRAIT_STYLE, "",
            "The character: the PATH WARDEN, the first keeper on the road. Weathered umber-and-bronze robes with a deep",
            "hood, a cracked bronze half-mask over the lower face, calm amber eyes, and a small hanging lantern with a warm",
            "amber flame held near one shoulder. Patient and watchful, the most welcoming of the three keepers.",
        ].join("\n"),
    },
    sentinel: {
        ref: "public/chronicle/keeper.webp", size: "1024x1024", out: "public/chronicle/path-sentinel.webp", width: 512, height: 512,
        prompt: [PORTRAIT_STYLE, "",
            "The character: the PATH SENTINEL, the keeper who guards the middle of the road. A hood of dark lacquered",
            "plates over a mail cowl, a pale silver mask cut by one vertical seal line, cold cyan eyes, and a dark spear",
            "haft crossing the lower frame diagonally. The drifting talismans glow faintly cyan. Stern and disciplined.",
        ].join("\n"),
    },
    arbiter: {
        ref: "public/chronicle/keeper.webp", size: "1024x1024", out: "public/chronicle/path-arbiter.webp", width: 512, height: 512,
        prompt: [PORTRAIT_STYLE, "",
            "The character: the PATH ARBITER, the last keeper, who judges the whole run. A tall crimson hood trimmed in",
            "old gold, a gilded mask engraved with a balance-scale seal, ember-orange eyes, and a small set of brass",
            "scales hanging at the edge of the frame beside a sealed scroll. Imposing and absolutely still.",
        ].join("\n"),
    },
    hero: {
        ref: "public/scenes/story/echoes-tower-hero.webp", size: "1536x1024", out: "public/chronicle/keeper-path-hero.webp", width: 1536, height: 640,
        prompt: [
            "The attached image is a scene from the same shinobi card-duel game. Use it ONLY as the reference for art",
            "style, palette, lighting and rendering. Do not redraw its tower or its composition.",
            "",
            "Paint ONE new wide establishing illustration in exactly that style, AAA hand-painted dark fantasy: KEEPER'S",
            "PATH, a trial of card duels. A narrow path of floating stone stepping slabs, each shaped like a large",
            "upright playing card laid flat, winds from the near foreground through a dark misty void toward three",
            "distant shrine gates, each gate higher and brighter than the last. Warm amber lanterns stand along the",
            "path; paper talismans with ink seals drift in the air; cool blue mist fills the void below. At the farthest",
            "gate a small hooded, masked keeper silhouette waits. Evening light, deep shadow, a strong sense of depth.",
            "",
            "Keep the important detail in the middle horizontal band of the image: its top and bottom quarters will be",
            "cropped away. No people in the foreground, no text, no letters, no logo, no watermark, no frame, no UI.",
        ].join("\n"),
    },
};

const MODEL = arg("model", "gpt-image-2");
const only = arg("only", "");
const jobs = Object.entries(JOBS).filter(([name]) => !only || name === only);
const scratch = path.join(HERE, ".keeper-path-art");
const key = envKey("OPENAI_API_KEY", arg("env-file", ""));

if (flag("dry-run")) {
    for (const [name, job] of jobs) console.log(`\n=== ${name} -> ${job.out}\n${job.prompt}`);
    process.exit(0);
}
if (!key) { console.error("error: OPENAI_API_KEY not found (env or shinobij.client/.env)"); process.exit(1); }
fs.mkdirSync(scratch, { recursive: true });

await Promise.all(jobs.map(async ([name, job]) => {
    const reference = await sharp(path.join(CLIENT, job.ref)).png().toBuffer();
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", job.prompt);
    form.append("image[]", new Blob([reference], { type: "image/png" }), "reference.png");
    form.append("size", job.size);
    form.append("quality", "high");
    form.append("output_format", "png");
    form.append("n", "1");
    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw new Error(`${name}: openai ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const b64 = (await res.json())?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`${name}: no image returned`);
    const raw = path.join(scratch, `${name}.png`);
    fs.writeFileSync(raw, Buffer.from(b64, "base64"));
    const out = path.join(CLIENT, job.out);
    await sharp(raw).resize(job.width, job.height, { fit: "cover", position: "centre" }).webp({ quality: 82, effort: 6 }).toFile(out);
    console.log(`${name}: wrote ${job.out} (${fs.statSync(out).size} bytes)`);
}));
