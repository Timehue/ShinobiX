import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Gateworks ordinary architecture. The authored source is a transparent
// three-silhouette sheet; global alpha gaps rather than an arbitrary grid define
// the crops, so no eave, finial or stair can leak into a neighbour or be clipped.
const source = resolve("src/assets/first-pact/gateworks-v2/gateworks-service-source.png");
const check = process.argv.includes("--check");
const report = process.argv.includes("--report");

// The generator paints a faint bloom into the alpha around each building. Treat
// anything below this as background, or the "silhouettes" merge into one blob.
const ALPHA_FLOOR = 40;

async function deliver(target, encoded, label) {
    if (check) {
        const current = await readFile(target);
        if (!current.equals(encoded)) throw new Error(`${label} is stale; run npm run author:first-pact-gateworks.`);
        return;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encoded);
}

const image = sharp(source);
const meta = await image.metadata();
const alpha = await image.clone().ensureAlpha().extractChannel(3).raw().toBuffer();
const solid = (x, y) => alpha[y * meta.width + x] >= ALPHA_FLOOR;

// Column occupancy -> vertical gaps -> one band per building.
const columnHit = [];
for (let x = 0; x < meta.width; x++) {
    let hit = 0;
    for (let y = 0; y < meta.height; y++) if (solid(x, y)) { hit = 1; break; }
    columnHit.push(hit);
}
const bands = [];
let start = -1;
for (let x = 0; x < meta.width; x++) {
    if (columnHit[x] && start < 0) start = x;
    if ((!columnHit[x] || x === meta.width - 1) && start >= 0) {
        const end = columnHit[x] ? x : x - 1;
        if (end - start >= 40) bands.push({ left: start, right: end });
        start = -1;
    }
}
if (bands.length !== 3) throw new Error(`expected 3 silhouettes, found ${bands.length}: ${JSON.stringify(bands)}`);

// Tighten each band vertically to its own ink.
const boxes = bands.map((band) => {
    let top = meta.height, bottom = -1;
    for (let y = 0; y < meta.height; y++) {
        for (let x = band.left; x <= band.right; x++) {
            if (!solid(x, y)) continue;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            break;
        }
    }
    return { left: band.left, top, width: band.right - band.left + 1, height: bottom - top + 1 };
});

// Tile footprints chosen so each reads at avatar scale beside the two halls:
// ordinary working buildings, never monuments.
const targets = [
    { id: "keeper-rowhouse", tiles: { w: 3, h: 6 } },
    { id: "maintenance-shed", tiles: { w: 6, h: 4 } },
    { id: "valve-house", tiles: { w: 4, h: 4 } },
];

if (report) {
    boxes.forEach((box, i) => {
        const t = targets[i];
        console.log(`${t.id}: crop ${box.width}x${box.height} at (${box.left},${box.top}) -> ${t.tiles.w * 48}x${t.tiles.h * 48} (${t.tiles.w}x${t.tiles.h} tiles), source aspect ${(box.width / box.height).toFixed(2)} target ${(t.tiles.w / t.tiles.h).toFixed(2)}`);
    });
}

for (let i = 0; i < targets.length; i++) {
    const { id, tiles } = targets[i];
    const encoded = await sharp(source)
        .extract(boxes[i])
        // contain, never fill: the footprints above are chosen to sit within a
        // hair of each silhouette's natural aspect, and stretching painted
        // architecture to force a tile box is exactly the tell the bar rejects.
        .resize({ width: tiles.w * 48, height: tiles.h * 48, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
    await deliver(resolve(`src/assets/first-pact/gateworks-v2/${id}.png`), encoded, id);
    if (report) console.log(`  wrote ${id}.png ${encoded.length} bytes`);
}

// The two halls are authored one per image: asking for both in one frame made
// the model compose edge to edge and clip the left building every time. Their
// alpha carries a faint bloom, so the silhouette is found well above it.
const HALL_FLOOR = 128;
const halls = [
    { id: "engine-hall", source: "engine-hall-source.png", tiles: { w: 7, h: 8 } },
    { id: "pump-house", source: "pump-house-source.png", tiles: { w: 7, h: 6 } },
    // A well head, not a hall: the small open structure that replaced the
    // maintenance shed south of the pump house.
    { id: "cistern-head", source: "cistern-head-source.png", tiles: { w: 3, h: 3 } },
];
for (const hall of halls) {
    const src = resolve(`src/assets/first-pact/gateworks-v2/${hall.source}`);
    const img = sharp(src);
    const m = await img.metadata();
    const a = await img.clone().ensureAlpha().extractChannel(3).raw().toBuffer();
    let left = m.width, right = -1, top = m.height, bottom = -1;
    for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
            if (a[y * m.width + x] < HALL_FLOOR) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    if (left <= 1 || top <= 1 || right >= m.width - 2 || bottom >= m.height - 2) {
        throw new Error(`${hall.id} silhouette touches the frame edge; regenerate it rather than shipping a crop.`);
    }
    const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
    const encoded = await sharp(src)
        .extract(box)
        .resize({ width: hall.tiles.w * 48, height: hall.tiles.h * 48, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
    await deliver(resolve(`src/assets/first-pact/gateworks-v2/${hall.id}.png`), encoded, hall.id);
    if (report) {
        console.log(`${hall.id}: crop ${box.width}x${box.height} at (${box.left},${box.top}) -> ${hall.tiles.w * 48}x${hall.tiles.h * 48} (${hall.tiles.w}x${hall.tiles.h} tiles), aspect ${(box.width / box.height).toFixed(2)} target ${(hall.tiles.w / hall.tiles.h).toFixed(2)}`);
        console.log(`  wrote ${hall.id}.png ${encoded.length} bytes`);
    }
}

// ---------------------------------------------------------------------------
// Arrival Court threshold pieces.
//
// The gatehouse is authored alone: in the three-piece row the model pinned it to
// the left edge and clipped its west pier every time. The lantern and the stele
// come from that row, whose second and third silhouettes are clean.
const ARRIVAL_FLOOR = 128;

async function silhouettes(file, floor) {
    const src = resolve(`src/assets/first-pact/gateworks-v2/${file}`);
    const img = sharp(src);
    const meta = await img.metadata();
    const alpha = await img.clone().ensureAlpha().extractChannel(3).raw().toBuffer();
    const on = (x, y) => alpha[y * meta.width + x] >= floor;
    const bands = [];
    let start = -1;
    for (let x = 0; x < meta.width; x++) {
        let hit = false;
        for (let y = 0; y < meta.height; y++) if (on(x, y)) { hit = true; break; }
        if (hit && start < 0) start = x;
        if ((!hit || x === meta.width - 1) && start >= 0) {
            const end = hit ? x : x - 1;
            if (end - start >= 40) bands.push({ left: start, right: end });
            start = -1;
        }
    }
    return { src, meta, bands: bands.map((band) => {
        let top = meta.height, bottom = -1;
        for (let y = 0; y < meta.height; y++) {
            for (let x = band.left; x <= band.right; x++) {
                if (!on(x, y)) continue;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                break;
            }
        }
        return { left: band.left, top, width: band.right - band.left + 1, height: bottom - top + 1 };
    }) };
}

async function emit(src, box, id, tiles, meta) {
    if (box.left <= 1 || box.top <= 1 || box.left + box.width >= meta.width - 2 || box.top + box.height >= meta.height - 2) {
        throw new Error(`${id} silhouette touches the frame edge; regenerate it rather than shipping a crop.`);
    }
    const encoded = await sharp(src)
        .extract(box)
        .resize({ width: tiles.w * 48, height: tiles.h * 48, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
    await deliver(resolve(`src/assets/first-pact/gateworks-v2/${id}.png`), encoded, id);
    if (report) console.log(`${id}: crop ${box.width}x${box.height} -> ${tiles.w * 48}x${tiles.h * 48} (${tiles.w}x${tiles.h} tiles), aspect ${(box.width / box.height).toFixed(2)} target ${(tiles.w / tiles.h).toFixed(2)}, ${encoded.length} bytes`);
}

const gate = await silhouettes("arrival-gate-source.png", ARRIVAL_FLOOR);
if (gate.bands.length !== 1) throw new Error(`expected 1 gatehouse silhouette, found ${gate.bands.length}`);
await emit(gate.src, gate.bands[0], "arrival-gate", { w: 9, h: 5 }, gate.meta);

const boundary = await silhouettes("arrival-boundary-source.png", ARRIVAL_FLOOR);
if (boundary.bands.length !== 3) throw new Error(`expected 3 boundary silhouettes, found ${boundary.bands.length}`);
await emit(boundary.src, boundary.bands[1], "boundary-lantern", { w: 1, h: 2 }, boundary.meta);
await emit(boundary.src, boundary.bands[2], "boundary-stele", { w: 1, h: 2 }, boundary.meta);
