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


// Arrival Court threshold. The south boundary is currently the last painted row
// of the map, so the city ends at the edge of the canvas. These three pieces
// build a constructed edge instead: a gatehouse the northbound spine passes
// through, and the flanking civic detail that makes it read as a threshold.
const ARRIVAL = [
    "Three separate pieces of ancient shinobi city boundary architecture, in one row left to right, with wide empty",
    "transparent space between them. Each is complete, self-contained, and never touches another.",
    "",
    VIEW,
    "",
    "Art language, matched exactly: deep indigo-blue ceramic tile roofs with warm brass ridge caps and gently curved",
    "upturned eaves; dark weathered grey stone with heavy masonry courses; aged timber; warm amber lantern light.",
    "Painted game asset, crisp clean edges, even lighting.",
    "",
    "Left, and much the largest: a city gatehouse seen head on. A wide stone rampart wall with a single tall arched",
    "opening dead centre that a road passes through, a heavy timber gate leaf folded open against each pier, a tiled",
    "roof along the top of the wall, and a lantern mounted on each pier beside the arch. The opening is a real hole:",
    "through it you see only empty transparent space, not sky, not scenery, not a door.",
    "Middle: a tall stone boundary lantern on a stepped plinth, one warm flame behind its panes.",
    "Right: a narrow carved boundary stele, a standing stone slab with an incised seal near its top.",
    "",
    "No cyan or teal glow anywhere. No banners, no flags, no text, no writing.",
    "",
    CLEAN,
].join("\n");

const set = arg("set", "service");
// The gatehouse alone. In the three-piece row the model composed it hard against
// the left edge every time and clipped its west pier, which the queue rejects.
const ARRIVAL_GATE = [
    "A single ancient shinobi city gatehouse, alone on an empty transparent background.",
    "",
    VIEW,
    "",
    "A wide stone rampart wall seen head on, with ONE tall arched opening dead centre that a road passes through.",
    "A heavy timber gate leaf stands folded open flat against each pier. A tiled roof runs along the top of the wall.",
    "One lantern is mounted on each pier beside the arch.",
    "",
    "THE OPENING IS A REAL HOLE: through the arch you see only empty transparent background. No sky, no landscape,",
    "no door filling it, no darkness painted into it.",
    "",
    "Art language, matched exactly: a deep indigo-blue ceramic tile roof with warm brass ridge caps and gently curved",
    "upturned eaves; dark weathered grey stone with heavy masonry courses; warm amber lantern light. Painted game asset,",
    "crisp clean edges, even lighting. No cyan or teal anywhere. No banners, no flags, no text, no writing.",
    "",
    "COMPOSITION: centre the gatehouse in the frame at about two thirds of the image width. Leave a wide empty",
    "transparent margin on ALL FOUR sides. No eave, lantern or plinth may touch or run off any edge of the image.",
    "A clipped gatehouse is unusable. No vignette, no glow halo, no backdrop, no ground plate, no cast shadow.",
].join("\n");

// The shed that stood south of the pump house read as a second house stacked
// under the first. What that corner wants is equipment with a roof over it, at
// a scale that lets the hall behind it stay the larger thing. Deliberately not
// built on ONE(): that wrapper insists on "a BUILDING", and the first attempt
// obeyed the wrapper over the subject and returned another walled house.
const CISTERN_HEAD = [
    "A single small ancient shinobi waterworks STRUCTURE, alone on an empty transparent background.",
    "",
    VIEW,
    "",
    "Art language, matched exactly: a deep indigo-blue ceramic tile roof with warm brass ridge caps and gently curved",
    "upturned eaves; dark weathered grey stone; aged timber posts and beams; warm amber lantern light. Painted game",
    "asset, crisp clean edges, even lighting.",
    "",
    "SUBJECT: an open covered cistern head. A broad, heavy circular stone kerb sitting at ground level with dark still",
    "water inside it. Four short stout timber corner posts stand on that kerb and carry ONE small square tiled canopy",
    "roof directly above the water. An iron winch drum with a rope and a wooden bucket hangs beneath the canopy. A brass",
    "overflow spout on the near side runs into a short stone channel. One small amber lantern hangs from a post.",
    "",
    "CRITICAL, and more important than every other instruction: this is NOT a building and NOT a house. It has NO WALLS",
    "of any kind, NO DOOR, NO WINDOWS, no facade and no interior. Between the four posts you see STRAIGHT THROUGH the",
    "structure, from one side out the other, to the empty transparent background behind it. Nobody lives here.",
    "",
    "SCALE AND SHAPE: it is WIDER THAN IT IS TALL, and low -- a person standing beside it would be as tall as the canopy",
    "eaves. Draw only this one small object. Do not add a wall, a hall, a gate or any larger building behind or beside it.",
    "",
    "Restrained teal-cyan light appears ONLY as a thin glow on the water inside the kerb. No cyan waterfalls, no glowing",
    "fountains, no energy beams, no ground plate, no cast shadow, no puddle.",
    "",
    "COMPOSITION: centre the structure in the frame at about half of the image height. Leave a wide empty transparent",
    "margin on ALL FOUR sides. No eave, post, rope or spout may touch or run off any edge. A clipped asset is unusable.",
    "No vignette, no glow halo, no backdrop, no text, no frame.",
].join("\n");

const SETS = {
    "cistern-head": { prompt: CISTERN_HEAD, file: "cistern-head-source.png", size: "1024x1024" },
    service: { prompt: SERVICE, file: "gateworks-service-source.png", size: "1536x1024" },
    "arrival-gate": { prompt: ARRIVAL_GATE, file: "arrival-gate-source.png", size: "1536x1024" },
    halls: { prompt: HALLS, file: "gateworks-halls-source.png", size: "1536x1024" },
    arrival: { prompt: ARRIVAL, file: "arrival-boundary-source.png", size: "1536x1024" },
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
