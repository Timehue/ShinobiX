// Composes the Grand Colosseum with a stair forecourt at each of its gates.
//
//   node scripts/compose-first-pact-colosseum.mjs
//
// The bowl (gateworks-v2/colosseum-raked.webp) covers tiles x31..52, y17..38
// and ends at each gate's canopy. Past it, the walkable stair strips used to
// render as bare procedural stripes. This lays the generated forecourt
// (colosseum-approach.webp, gate side up) under each gate, rotated to face
// outward, then the bowl on top, so the bowl's canopies cover the seam.
//
// North and south get the full forecourt: the High Court and Arrival Court
// approaches have room for it. West and east get only its first one and a half
// tiles of steps, because the canal bridge and the market sit right there.
//
// Output: gateworks-v2/colosseum-gates.webp, drawn by FirstPact.tsx over
// FIRST_PACT_COLOSSEUM_ART (tiles x29..54, y13..42).
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "../src/assets/first-pact/gateworks-v2");

// Must match FIRST_PACT_COLOSSEUM_ART in FirstPact.tsx.
const ART = { x: 29, y: 13, width: 26, height: 30 };
const BOWL = { x: 31, y: 17, size: 22 };
const CENTER = { x: 42, y: 28 };
// The bowl's gate canopies end 9.98 tiles from its centre; each forecourt
// starts 0.4 tiles inside that so the canopy overlaps the join.
const GATE_REACH = 9.6;

const bowl = sharp(path.join(DIR, "colosseum-raked.webp"));
const { width: bowlPx } = await bowl.metadata();
const PX = bowlPx / BOWL.size;
const px = (tiles) => Math.round(tiles * PX);

const approachPath = path.join(DIR, "colosseum-approach.webp");
const approachMeta = await sharp(approachPath).metadata();

/** The forecourt, gate side up, cut to `depth` tiles and scaled to the bowl's density. */
async function forecourt(depth) {
    const cut = Math.round(approachMeta.height * depth / 4);
    return sharp(approachPath)
        .extract({ left: 0, top: 0, width: approachMeta.width, height: cut })
        .resize(px(5), px(depth), { fit: "fill", kernel: "lanczos3" })
        .png()
        .toBuffer();
}

const full = await forecourt(4);
const short = await forecourt(1.5);
const placements = [
    // South: gate side up already. Top edge at the canopy, extending south.
    { input: full, left: px(CENTER.x - 2.5 - ART.x), top: px(CENTER.y + GATE_REACH - ART.y) },
    // North: turned half way, extending north from the canopy.
    { input: await sharp(full).rotate(180).png().toBuffer(), left: px(CENTER.x - 2.5 - ART.x), top: px(CENTER.y - GATE_REACH - 4 - ART.y) },
    // West: gate side faces east, steps run west.
    { input: await sharp(short).rotate(90).png().toBuffer(), left: px(CENTER.x - GATE_REACH - 1.5 - ART.x), top: px(CENTER.y - 2.5 - ART.y) },
    // East: gate side faces west, steps run east.
    { input: await sharp(short).rotate(-90).png().toBuffer(), left: px(CENTER.x + GATE_REACH - ART.x), top: px(CENTER.y - 2.5 - ART.y) },
];

const output = path.join(DIR, "colosseum-gates.webp");
const info = await sharp({ create: { width: px(ART.width), height: px(ART.height), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
        ...placements,
        { input: await bowl.png().toBuffer(), left: px(BOWL.x - ART.x), top: px(BOWL.y - ART.y) },
    ])
    .webp({ quality: 88, alphaQuality: 95, effort: 6 })
    .toFile(output);
console.log(`wrote ${path.relative(process.cwd(), output)} ${info.width}x${info.height} ${info.size} bytes (${PX.toFixed(2)} px per tile)`);
