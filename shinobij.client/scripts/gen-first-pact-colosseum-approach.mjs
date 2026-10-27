// Authors the Grand Colosseum gate approach: the stair forecourt that leads out
// of each of the bowl's four gates into the street.
//
//   node scripts/gen-first-pact-colosseum-approach.mjs [--ref <png>] [--out <path>] [--env-file <path>] [--dry-run]
//
// The bowl (sunken-court-colosseum-source.png) is drawn perfectly overhead,
// unlike the district buildings, which are front elevations. So this asset is
// overhead too, and it is generated as an EDIT against a crop of the bowl's own
// south gate, which the model uses as its style and palette reference. The
// street beyond each gate used to show bare procedural stair stripes.
//
// gpt-image-2 by default (--model to override), transparent background, saved as the raw PNG that
// process-first-pact-colosseum-approach.mjs crops and scales.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const PROMPT = [
    "The attached image is part of the south gate of a monumental circular pet-battle colosseum in an ancient shinobi",
    "city, painted perfectly overhead. Use it ONLY as the reference for art style, palette, materials and lighting.",
    "Do not redraw the colosseum, its seating rings, its roofs or its gate.",
    "",
    "Paint ONE new, separate asset in exactly that style: the stone STAIR FORECOURT that leads out of such a gate",
    "and down into the street, seen from DIRECTLY OVERHEAD, a perfectly top-down orthographic view with no perspective",
    "tilt, exactly like the reference.",
    "",
    "Layout, top to bottom:",
    "- The TOP EDGE of the asset is a straight horizontal line, where it will butt against the gate's threshold.",
    "- Below it, a broad flight of six or seven wide, shallow stone steps descends away from the gate. Draw the steps as",
    "  parallel horizontal bands of worn dark-grey ashlar, each with a thin warm bronze nosing line.",
    "- At the bottom, a short flagstone landing paved in the same weathered grey stone as the reference's walkways.",
    "- Down both long sides, a low stone balustrade wall capped with aged bronze, studded with small warm amber lamps",
    "  like the rails in the reference.",
    "- At the two bottom corners, a square stone pier carrying a bronze lantern with a warm amber flame, and beside each",
    "  pier a slim pole hanging a narrow burgundy banner with a small gold crest, seen from above.",
    "",
    "Art language, matched exactly to the reference: AAA hand-painted dark fantasy realism; dark weathered grey stone;",
    "aged bronze and brass trim; warm amber lantern light; burgundy and gold banners; at most one tiny restrained cyan",
    "accent. Crisp clean edges, evening light, compact contained shadows.",
    "",
    "SHAPE: the stair forecourt is WIDER THAN IT IS DEEP, about five units wide by four units deep, perfectly",
    "symmetrical left to right, centred in the frame.",
    "",
    "Fully transparent background around it: no ground beyond the forecourt, no grass, no street, no water, no",
    "vignette, no glow halo, no cast shadow outside its edge. No people, no animals, no text, no letters, no logo,",
    "no frame. Leave a clear empty transparent margin on the left, right and bottom; nothing may touch those edges.",
].join("\n");

const refPath = path.resolve(arg("ref", path.join(CLIENT, "src/assets/first-pact/colosseum-approach-ref.png")));
const outPath = path.resolve(arg("out", path.join(CLIENT, "src/assets/first-pact/gateworks-v2/colosseum-approach-source.png")));
const key = envKey("OPENAI_API_KEY", arg("env-file", ""));
// The images edit endpoint no longer accepts gpt-image-1 (2026-10-26).
const MODEL = arg("model", "gpt-image-2");

console.log(`model:  ${MODEL} edit 1024x1024 quality=high transparent-bg`);
console.log(`ref:    ${refPath}`);
console.log(`out:    ${outPath}`);
if (flag("dry-run")) { console.log("\n--- prompt ---\n" + PROMPT); process.exit(0); }
if (!key) { console.error("error: OPENAI_API_KEY not found (env, --env-file, or shinobij.client/.env)"); process.exit(1); }
if (!fs.existsSync(refPath)) { console.error(`error: reference image not found: ${refPath}`); process.exit(1); }

const form = new FormData();
form.append("model", MODEL);
form.append("prompt", PROMPT);
form.append("image[]", new Blob([fs.readFileSync(refPath)], { type: "image/png" }), "reference.png");
form.append("size", "1024x1024");
form.append("quality", "high");
form.append("background", "transparent");
form.append("output_format", "png");
form.append("n", "1");

const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
});
if (!res.ok) { console.error(`openai ${res.status}: ${(await res.text()).slice(0, 500)}`); process.exit(1); }
const body = await res.json();
const b64 = body?.data?.[0]?.b64_json;
if (!b64) { console.error("no image returned"); process.exit(1); }

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
console.log(`wrote   ${fs.statSync(outPath).size} bytes`);
