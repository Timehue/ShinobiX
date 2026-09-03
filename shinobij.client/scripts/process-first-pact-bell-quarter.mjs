import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("src/assets/first-pact/sunken-court-architecture-atlas.webp");
const target = resolve("src/assets/first-pact/bell-quarter-v2/bell-quarter-architecture-strip.png");
const check = process.argv.includes("--check");

// The legacy 4x4 atlas allowed silhouettes to overhang cell boundaries. These
// global crops follow connected alpha components instead of the old grid, so
// every roof ridge, lateral eave, south door, and stair survives intact.
const silhouettes = [
    { id: "open-bell-tower", left: 188, top: 724, width: 183, height: 276 },
    { id: "bell-quarter-residence", left: 1107, top: 758, width: 246, height: 241 },
    { id: "bell-scribe-townhouse", left: 529, top: 9, width: 220, height: 273 },
    { id: "bell-courier-house", left: 793, top: 514, width: 252, height: 229 },
];

// One source pixel remains at least one delivered canvas pixel at the authored
// 48px world scale; larger repacks only increase download size, not detail.
const cellWidth = 288;
const cellHeight = 432;
const composites = [];
for (let index = 0; index < silhouettes.length; index += 1) {
    const silhouette = silhouettes[index];
    const input = await sharp(source)
        .extract({ left: silhouette.left, top: silhouette.top, width: silhouette.width, height: silhouette.height })
        .resize(cellWidth, cellHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9, palette: false })
        .toBuffer();
    composites.push({ input, left: index * cellWidth, top: 0 });
}

const encoded = await sharp({
    create: {
        width: cellWidth * silhouettes.length,
        height: cellHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
})
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

if (check) {
    const current = await readFile(target);
    if (!current.equals(encoded)) throw new Error("Bell Quarter architecture strip is stale; run npm run author:first-pact-bell.");
    process.stdout.write(`Bell Quarter architecture verified: ${target}\n`);
} else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encoded);
    process.stdout.write(`Bell Quarter architecture authored: ${target}\n`);
}
