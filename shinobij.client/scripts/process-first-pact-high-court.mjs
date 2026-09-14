import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("src/assets/first-pact/high-court-v3/high-court-architecture-source.png");
const gardenSource = resolve("src/assets/first-pact/high-court-v3/high-court-garden-source.png");
const check = process.argv.includes("--check");

async function deliver(target, encoded, label) {
    if (check) {
        const current = await readFile(target);
        if (!current.equals(encoded)) throw new Error(`${label} is stale; run npm run author:first-pact-high-court.`);
        return;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encoded);
}

// The authored source is a transparent three-silhouette sheet. Global alpha
// gaps, rather than equal source cells, define the crops so no eave, roof finial,
// or south stair can leak into a neighbor or be clipped by an arbitrary grid.
const buildings = [
    {
        id: "main-archive",
        crop: { left: 78, top: 5, width: 901, height: 679 },
        size: { width: 9 * 48, height: 7 * 48 },
    },
    {
        id: "record-hall",
        crop: { left: 1041, top: 174, width: 555, height: 463 },
        size: { width: 6 * 48, height: 5 * 48 },
    },
    {
        id: "council-annex",
        crop: { left: 1686, top: 235, width: 434, height: 400 },
        size: { width: 5 * 48, height: 5 * 48 },
    },
];

const metadata = await sharp(source).metadata();
if (metadata.width !== 2172 || metadata.height !== 724 || !metadata.hasAlpha) {
    throw new Error(`Unexpected High Court source: ${metadata.width}x${metadata.height}, alpha=${metadata.hasAlpha}`);
}

for (const building of buildings) {
    const target = resolve(`src/assets/first-pact/high-court-v3/high-court-${building.id}.png`);
    const encoded = await sharp(source)
        .extract(building.crop)
        .resize(building.size.width, building.size.height, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            kernel: sharp.kernel.lanczos3,
        })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();

    await deliver(target, encoded, building.id);
}

// Four compact raised planters replace procedural ground panels. Every cell is
// an exact 4x3 world-tile canvas; the two shorter modules retain transparent
// north/south breathing room rather than being stretched into a taller plate.
const gardenCrops = [
    { left: 81, top: 200, width: 420, height: 326 },
    { left: 607, top: 217, width: 414, height: 309 },
    { left: 1145, top: 274, width: 413, height: 252 },
    { left: 1673, top: 294, width: 408, height: 232 },
];
const gardenMetadata = await sharp(gardenSource).metadata();
if (gardenMetadata.width !== 2172 || gardenMetadata.height !== 724 || !gardenMetadata.hasAlpha) {
    throw new Error(`Unexpected High Court garden source: ${gardenMetadata.width}x${gardenMetadata.height}, alpha=${gardenMetadata.hasAlpha}`);
}
const gardenCellWidth = 4 * 48;
const gardenCellHeight = 3 * 48;
const gardenComposites = await Promise.all(gardenCrops.map(async (crop, index) => ({
    input: await sharp(gardenSource)
        .extract(crop)
        .resize(gardenCellWidth, gardenCellHeight, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            kernel: sharp.kernel.lanczos3,
        })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer(),
    left: index * gardenCellWidth,
    top: 0,
})));
const gardenStrip = await sharp({
    create: {
        width: gardenCellWidth * gardenCrops.length,
        height: gardenCellHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
})
    .composite(gardenComposites)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
await deliver(resolve("src/assets/first-pact/high-court-v3/high-court-garden-strip.png"), gardenStrip, "garden strip");

process.stdout.write(`High Court assets ${check ? "verified" : "authored"}: ${buildings.length} buildings + ${gardenCrops.length} raised gardens\n`);
