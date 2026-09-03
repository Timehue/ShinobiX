// Authors the Gateworks ordinary-architecture source sheet.
//
//   node scripts/gen-first-pact-gateworks.mjs [--out <path>] [--dry-run]
//
// gpt-image-1 with a transparent background, saved as the raw PNG the
// process-first-pact-* scripts expect. The district's two halls are monuments;
// what the acceptance queue asks for is ORDINARY working architecture at avatar
// scale to subordinate them, in the same language the accepted Market and
// Gardens sets already speak.
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
            const m = line.match(new RegExp("^" + name + "\\s*=\\s*(.+)$"));
            if (m) return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return "";
}

const VIEW = [
    "VIEW, and this is the most important instruction: draw each building as a FLAT FRONT ELEVATION, seen straight on",
    "from directly in front, the way a facade is drawn on a stage flat. The face of every building points at the viewer.",
    "Absolutely NO isometric projection, NO three-quarter view, NO angled or receding side walls, NO corner-on perspective.",
    "Tilt the camera only very slightly above eye level, just enough that the roof tiles read. A symmetrical building must",
    "appear perfectly symmetrical, its door dead centre.",
].join("\n");

const CLEAN = [
    "COMPOSITION: place the buildings together in the CENTRE of the frame, filling only the middle two thirds of the",
    "width. Leave at least 15% of the image width entirely empty on the LEFT edge and at least 15% entirely empty on the",
    "RIGHT edge, and leave empty space above and below. No part of any building — no eave, no pipe, no lantern, no step —",
    "may touch or run off any edge of the image. A building clipped by the frame is unusable.",
    "",
    "Fully transparent background with nothing behind the buildings: no vignette, no glow halo, no light bloom,",
    "no dark backdrop, no ground plate, no cast shadow, no water, no text, no labels, no frame.",
].join("\n");

// The two working halls, re-scaled. The queue rejects the shipped pair as
// oversized cyan-heavy monuments; these are the same district function drawn as
// buildings a person could work in, with the glow confined to real mechanisms.
const HALLS = [
    "Two separate ancient shinobi waterworks halls, side by side in one row, with wide empty transparent space between",
    "them. Each is complete, self-contained, and never touches the other.",
    "",
    VIEW,
    "",
    "Art language, matched exactly: deep indigo-blue ceramic tile roofs with warm brass ridge caps and gently curved",
    "upturned eaves; dark weathered grey stone walls with heavy masonry bases; aged timber beams; warm amber lantern",
    "light at the doors. Painted game asset, crisp clean edges, even lighting.",
    "",
    "SCALE: these are large working buildings, but they are BUILDINGS, not temples or monuments. Roughly three storeys,",
    "wide enough for a cart door. Keep the masonry courses and roof tiles the same physical size as on a small house so",
    "the two halls and an ordinary cottage plainly belong to one town.",
    "",
    "Left: the engine hall, a broad stone hall with a tall arched cart door dead centre, a row of clerestory windows,",
    "and one narrow brass pipe stack rising from the roof.",
    "Right: the pump house, a slightly smaller square stone hall with a heavy timber double door, a brass flywheel",
    "mounted flat on the wall beside the door, and a low tiled porch.",
    "",
    "Restrained teal-cyan light appears ONLY as a thin glow inside the brass mechanisms and behind the clerestory glass.",
    "The walls, roofs and ground stay dark stone and indigo. No cyan waterfalls, no glowing fountains, no energy beams.",
    "",
    CLEAN,
].join("\n");

// Three complete silhouettes, generously separated so the alpha-gap cropper can
// split them without an eave or a lantern leaking into a neighbour.
const SERVICE = [
    "Three separate small buildings from an ancient shinobi waterworks district, arranged in one row left to right,",
    "with wide empty transparent space between them. Each building is complete, self-contained, and never touches another.",
    "",
    "VIEW, and this is the most important instruction: draw each building as a FLAT FRONT ELEVATION, seen straight on",
    "from directly in front, the way a facade is drawn on a stage flat. The face of every building points at the viewer.",
    "Absolutely NO isometric projection, NO three-quarter view, NO angled or receding side walls, NO corner-on perspective.",
    "Tilt the camera only very slightly above eye level, just enough that the roof tiles read. A symmetrical building must",
    "appear perfectly symmetrical, its door dead centre.",
    "",
    "Art language, matched exactly: deep indigo-blue ceramic tile roofs with warm brass ridge caps and gently curved",
    "upturned eaves; dark weathered grey stone bases and aged timber walls; warm amber lantern light in the windows and",
    "over each door; a short stone stair at the front entrance of each building. Painted game asset, crisp clean edges,",
    "even lighting.",
    "",
    "These are ORDINARY working buildings, modest and utilitarian, the scale of a two-storey house beside a person.",
    "They are not temples, not palaces, not monuments, and carry no glowing machinery.",
    "",
    "Left: a pump keeper's narrow two-storey rowhouse with a tiled porch roof over its door.",
    "Middle: a low wide maintenance store shed, one storey, with open timber tool bays along its front and a stone plinth.",
    "Right: a small square stone valve house with a brass pipe collar on its flank and a single lantern by the door.",
    "",
    "Fully transparent background with nothing behind the buildings: no vignette, no glow halo, no light bloom,",
    "no dark backdrop, no ground plate, no cast shadow, no water, no cyan or teal glow, no text, no labels, no frame.",
    "Keep every building fully inside the image with clear empty margin on all four sides; nothing may touch an edge.",
].join("\n");


// One building per image. Asking for two halls side by side made the model
// compose edge to edge every time and clip the left hall, which the acceptance
// queue rejects outright as a visible crop.
const ONE = (subject) => [
    "A single ancient shinobi waterworks building, alone on an empty transparent background.",
    "",
    VIEW,
    "",
    "Art language, matched exactly: a deep indigo-blue ceramic tile roof with warm brass ridge caps and gently curved",
    "upturned eaves; dark weathered grey stone walls with a heavy masonry base; aged timber beams; warm amber lantern",
    "light at the door. Painted game asset, crisp clean edges, even lighting.",
    "",
    "SCALE: a large working building, but a BUILDING, not a temple or a monument. Keep the masonry courses and roof tiles",
    "the same physical size they would be on a small house, so this and an ordinary cottage plainly belong to one town.",
    "",
    subject,
    "",
    "Restrained teal-cyan light appears ONLY as a thin glow inside brass mechanisms and behind glass. Walls and roof stay",
    "dark stone and indigo. No cyan waterfalls, no glowing fountains, no energy beams, no ground plate, no cast shadow.",
    "",
    "COMPOSITION: centre the building in the frame at about two thirds of the image height. Leave a wide empty transparent",
    "margin on ALL FOUR sides. No eave, pipe, lantern or step may touch or run off any edge. A clipped building is unusable.",
    "No vignette, no glow halo, no backdrop, no text, no frame.",
].join("\n");

const ENGINE_HALL = ONE("The engine hall: a broad stone hall with a tall arched cart door dead centre, a row of small clerestory windows above it, and one narrow brass pipe stack rising from the roof.");
const PUMP_HOUSE = ONE("The pump house: a square stone hall with a heavy timber double door dead centre, a large brass flywheel mounted flat on the wall beside the door, and a low tiled porch over the entrance.");

const set = arg("set", "service");
const SETS = {
    service: { prompt: SERVICE, file: "gateworks-service-source.png", size: "1536x1024" },
    halls: { prompt: HALLS, file: "gateworks-halls-source.png", size: "1536x1024" },
    "engine-hall": { prompt: ENGINE_HALL, file: "engine-hall-source.png", size: "1024x1024" },
    "pump-house": { prompt: PUMP_HOUSE, file: "pump-house-source.png", size: "1024x1024" },
};
if (!SETS[set]) { console.error(`error: --set must be one of ${Object.keys(SETS).join(", ")}`); process.exit(1); }
const PROMPT = SETS[set].prompt;
const outPath = path.resolve(arg("out", path.join(CLIENT, "src/assets/first-pact/gateworks-v2", SETS[set].file)));
const key = envKey("OPENAI_API_KEY");
if (!key) { console.error("error: OPENAI_API_KEY not found in env or shinobij.client/.env"); process.exit(1); }

console.log(`model:  gpt-image-1 ${SETS[set].size} quality=high transparent-bg`);
console.log(`out:    ${path.relative(CLIENT, outPath)}`);
if (flag("dry-run")) { console.log("\n--- prompt ---\n" + PROMPT); process.exit(0); }

const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
        model: "gpt-image-1",
        prompt: PROMPT,
        size: SETS[set].size,
        quality: "high",
        n: 1,
        background: "transparent",
        output_format: "png",
    }),
});
if (!res.ok) { console.error(`openai ${res.status}: ${(await res.text()).slice(0, 500)}`); process.exit(1); }
const body = await res.json();
const b64 = body?.data?.[0]?.b64_json;
if (!b64) { console.error("no image returned"); process.exit(1); }

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
console.log(`wrote   ${fs.statSync(outPath).size} bytes`);
