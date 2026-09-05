import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const check = process.argv.includes("--check");
const assetRoot = resolve("src/assets/first-pact/gardens-north-v2");
const plantingSourceRoot = resolve("output/first-pact-gardens-north/planting-alternatives");
const southSourceRoot = resolve("output/first-pact-gardens-south/asset-alternatives");
const kaioCourtSourceRoot = resolve("output/first-pact-kaio-court/asset-alternatives");

const buildings = [
    {
        id: "garden-lodge",
        source: resolve(assetRoot, "garden-lodge-source.png"),
        sourceSize: { width: 1303, height: 1207 },
        crop: { left: 70, top: 8, width: 1164, height: 1127 },
        rendered: { width: 340, height: 328 },
        canvas: { width: 9 * 48, height: 9 * 48, left: 46, top: 8 },
    },
    {
        id: "guardian-hall",
        source: resolve(assetRoot, "guardian-hall-source.png"),
        sourceSize: { width: 1536, height: 1024 },
        crop: { left: 129, top: 4, width: 1277, height: 998 },
        rendered: { width: 425, height: 332 },
        canvas: { width: 10 * 48, height: 8 * 48, left: 27, top: 4 },
    },
    {
        id: "garden-court-pavilion",
        source: resolve(southSourceRoot, "guardian-gardens-south-tea-archive-pavilion-v1.png"),
        sourceSize: { width: 1199, height: 692 },
        crop: { left: 0, top: 0, width: 1199, height: 692 },
        rendered: { width: 368, height: 212 },
        canvas: { width: 8 * 48, height: 5 * 48, left: 8, top: 14 },
    },
];

const courtProps = [
    {
        id: "garden-court-kaio-tree",
        source: resolve(kaioCourtSourceRoot, "kaio-guardian-tree-root-pocket-r4.png"),
        sourceSize: { width: 762, height: 656 },
        rendered: { width: 209, height: 180 },
        // Exact left-hand R5 critic composition. The 48px listener tile begins
        // at (192,192); its offset from this tree is therefore (174,147).
        canvas: { width: 5 * 48, height: 5 * 48, left: 18, top: 45 },
    },
    {
        id: "garden-court-listening-bench",
        source: resolve(kaioCourtSourceRoot, "kaio-low-listening-bench-r1.png"),
        sourceSize: { width: 528, height: 254 },
        rendered: { width: 110, height: 53 },
        // In world space this keeps the approved (+231,+122) tree-to-bench
        // offset and one completely alpha-free tile between both silhouettes.
        canvas: { width: 3 * 48, height: 2 * 48, left: 9, top: 23 },
    },
    {
        id: "garden-court-fountain",
        source: resolve(southSourceRoot, "guardian-gardens-south-guardian-pool-v1.png"),
        sourceSize: { width: 948, height: 705 },
        rendered: { width: 184, height: 137 },
        canvas: { width: 4 * 48, height: 3 * 48, left: 4, top: 3 },
    },
];

const plantings = [
    { id: "autumn-maple-a", source: "guardian-gardens-autumn-maple-a-v2.png", width: 707, height: 747 },
    { id: "autumn-maple-b", source: "guardian-gardens-autumn-maple-b-v2.png", width: 492, height: 610 },
    { id: "bed-long", source: "guardian-gardens-bed-long-v2.png", width: 656, height: 295 },
    { id: "bed-corner", source: "guardian-gardens-bed-corner-v2.png", width: 393, height: 319 },
];

async function deliver(target, encoded, label) {
    if (check) {
        const current = await readFile(target);
        if (!current.equals(encoded)) {
            throw new Error(`${label} is stale; run npm run author:first-pact-gardens-north.`);
        }
        return;
    }
    await writeFile(target, encoded);
}

for (const building of buildings) {
    const metadata = await sharp(building.source).metadata();
    if (
        metadata.width !== building.sourceSize.width
        || metadata.height !== building.sourceSize.height
        || !metadata.hasAlpha
    ) {
        throw new Error(
            `Unexpected ${building.id} source: ${metadata.width}x${metadata.height}, alpha=${metadata.hasAlpha}`,
        );
    }

    const silhouette = await sharp(building.source)
        .extract(building.crop)
        .resize(building.rendered.width, building.rendered.height, {
            fit: "fill",
            kernel: sharp.kernel.lanczos3,
        })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    const encoded = await sharp({
        create: {
            width: building.canvas.width,
            height: building.canvas.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([{ input: silhouette, left: building.canvas.left, top: building.canvas.top }])
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();

    await deliver(resolve(assetRoot, `${building.id}.png`), encoded, building.id);
}

for (const prop of courtProps) {
    const metadata = await sharp(prop.source).metadata();
    if (
        metadata.width !== prop.sourceSize.width
        || metadata.height !== prop.sourceSize.height
        || !metadata.hasAlpha
    ) {
        throw new Error(
            `Unexpected ${prop.id} source: ${metadata.width}x${metadata.height}, alpha=${metadata.hasAlpha}`,
        );
    }
    const silhouette = await sharp(prop.source)
        .resize(prop.rendered.width, prop.rendered.height, {
            fit: "fill",
            kernel: sharp.kernel.lanczos3,
        })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    const encoded = await sharp({
        create: {
            width: prop.canvas.width,
            height: prop.canvas.height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([{ input: silhouette, left: prop.canvas.left, top: prop.canvas.top }])
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    await deliver(resolve(assetRoot, `${prop.id}.png`), encoded, prop.id);
}

for (const planting of plantings) {
    const source = resolve(plantingSourceRoot, planting.source);
    const metadata = await sharp(source).metadata();
    if (
        metadata.width !== planting.width
        || metadata.height !== planting.height
        || !metadata.hasAlpha
    ) {
        throw new Error(
            `Unexpected ${planting.id} source: ${metadata.width}x${metadata.height}, alpha=${metadata.hasAlpha}`,
        );
    }
    const encoded = await sharp(source)
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    await deliver(resolve(assetRoot, `${planting.id}.png`), encoded, planting.id);
}

process.stdout.write(
    `Guardian Gardens ${check ? "verified" : "authored"}: ${buildings.length} matched-scale buildings, ${plantings.length} transparent planting modules, ${courtProps.length} public-court landmarks\n`,
);
