// Authors the interior cast portrait atlas for Celestial Tower: The First Pact.
//
//   node scripts/gen-first-pact-interior-cast.mjs [--out <path>] [--dry-run]
//
// The six people who stand INSIDE the city's six enterable buildings shipped as
// letter tiles while every street face beside them is a painted portrait, so a
// room read as unfinished the moment you walked into it. This is the same
// 3x2 / 1536x1024 atlas the street cast used (see sunken-court-cast-atlas.txt),
// sliced by process-first-pact-interior-cast.mjs into 512px cells.
//
// Cell order is the slicer's order, and the slicer's order is the interior
// order in lib/first-pact-interiors.ts. Do not reshuffle one without the other.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes("--" + n);

function envKey(name) {
    if (process.env[name]) return process.env[name].trim();
    const p = path.join(CLIENT, ".env");
    if (fs.existsSync(p)) {
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
            const m = line.match(new RegExp("^" + name + "\s*=\s*(.+)$"));
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

// Deliberately worded like sunken-court-cast-atlas.txt: same world, same
// framing, same light, so an indoor face and the street face outside its door
// cannot look like they came from two art directors.
const PROMPT = [
    "Create a production-ready 3 columns by 2 rows character portrait atlas for a dark painterly fantasy city,",
    "the ancient Sunken Court. EXACTLY six equal portrait cells, flush edge-to-edge, consistent framing from the chest",
    "up, each character centred alone in their own cell and filling it, no overlapping between cells.",
    "",
    "STYLE, which matters more than any single description below: rich, glossy, high-detail AAA fantasy RPG dialogue",
    "portraits in the manner of premium hand-painted concept art. Saturated jewel tones — deep indigo, teal-cyan glass,",
    "warm amber lamplight, brass and gold trim — with a strong warm rim light along one shoulder and the jaw and a cool",
    "teal fill opposite. Crisp rendered fabric, embroidered civic garments with brass fittings and fine gold edging.",
    "This is NOT a muted brown oil portrait and NOT a flat museum painting: the contrast is high and the colour luminous.",
    "",
    "BACKGROUND in every cell: luminous deep-blue vaulted interior architecture behind the figure, softly out of focus —",
    "carved stone piers, tall shelves of bound records, small points of amber lantern light and panels of glowing",
    "teal-cyan glass. Never a plain dark void.",
    "",
    "These six are the indoor keepers and civil servants of that city, each at their own post.",
    "",
    "Top row left to right:",
    "Warden Ashi, a lean middle-aged archive warden in a deep teal archivist coat with tarnished brass buttons and dusty",
    "cuffs, a cyan glass lens on a chain at the collar, an unfiled bundle of papers held to the chest, weary patient eyes.",
    "Ledger-keeper Mun, a broad older ledger-keeper in a heavy charcoal coat with amber-gold facings, reading spectacles",
    "pushed up onto the forehead, ink-stained fingers, a big brass ledger key on a chain, blunt and unimpressed.",
    "Attendant Sero, a careful young council attendant in high-collared slate-grey civic livery with polished silver",
    "piping and a bronze collar pin, a wooden appointment tablet held flat to the chest, watchful sidelong glance.",
    "",
    "Bottom row left to right:",
    "Oathkeeper Bel, a composed guardian-hall oathkeeper in layered jade-green robes over lacquered bronze shoulder",
    "armour, a wide engraved bronze oath-band on the forearm, dark hair drawn back tight, stern and still.",
    "Steward Nia, a rose-and-wine wool lodge steward with a braided keeper's cord over one shoulder and brass clasps,",
    "a roster board under one arm, greying hair pinned up, warm, protective and direct.",
    "Juno, a young tea-archive apprentice in a jade apron over pale linen with sleeves tied back, a small notebook and a",
    "writing brush in hand, bright and quick, warm kettle steam catching the lamplight behind one shoulder.",
    "",
    "Grounded ordinary human faces, readable silhouettes at small size, restrained detail in the background so the face",
    "reads first, one cohesive art director across all six. Preserve a strict rectangular six-cell grid.",
    "",
    "No text, no letters, no captions, no numbers, no symbols, no logos, no border, no watermark, no UI, no animals,",
    "no weapons drawn, no extra people in any cell.",
].join("\n");

const outPath = path.resolve(arg("out", path.join(CLIENT, "src/assets/first-pact/interior-cast-atlas-source.png")));
const key = envKey("OPENAI_API_KEY");

console.log("model:  gpt-image-1 1536x1024 quality=high");
console.log(`out:    ${path.relative(CLIENT, outPath)}`);
if (flag("dry-run")) { console.log("\n--- prompt ---\n" + PROMPT); process.exit(0); }
if (!key) { console.error("error: OPENAI_API_KEY not found in env or shinobij.client/.env"); process.exit(1); }

// This offline generator intentionally sends its curated prompt and configured API credential to OpenAI.
// codeql[js/file-access-to-http]
const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt: PROMPT, size: "1536x1024", quality: "high", n: 1, output_format: "png" }),
});
if (!res.ok) { console.error(`openai ${res.status}: ${(await res.text()).slice(0, 500)}`); process.exit(1); }
const body = await res.json();
const b64 = body?.data?.[0]?.b64_json;
if (!b64) { console.error("no image returned"); process.exit(1); }

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
console.log(`wrote   ${fs.statSync(outPath).size} bytes`);
