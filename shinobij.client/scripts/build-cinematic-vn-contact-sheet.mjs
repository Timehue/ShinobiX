import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
if (outputIndex < 0 || !args[outputIndex + 1]) {
    console.error("Usage: node scripts/build-cinematic-vn-contact-sheet.mjs --output <file.png> <image...>");
    process.exit(1);
}

const output = path.resolve(args[outputIndex + 1]);
const inputs = args.filter((_, index) => index !== outputIndex && index !== outputIndex + 1).map((file) => path.resolve(file));
if (!inputs.length) {
    console.error("Add at least one image.");
    process.exit(1);
}

const tileWidth = 360;
const tileHeight = 300;
const labelHeight = 38;
const artHeight = tileHeight - labelHeight;
const columns = Math.min(4, inputs.length);
const rows = Math.ceil(inputs.length / columns);
const composites = [];

for (const [index, input] of inputs.entries()) {
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * tileHeight;
    const actor = await sharp(input)
        .resize(tileWidth, artHeight, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
    // A colored checker makes both white and black baked cards obvious. The
    // former solid near-black sheet could hide exactly the matte regression
    // this QA artifact is meant to expose.
    const checker = Buffer.from(
        `<svg width="${tileWidth}" height="${artHeight}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <pattern id="checker" width="32" height="32" patternUnits="userSpaceOnUse">
                    <rect width="32" height="32" fill="#17324a"/>
                    <rect width="16" height="16" fill="#7a4a2a"/>
                    <rect x="16" y="16" width="16" height="16" fill="#7a4a2a"/>
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#checker)"/>
        </svg>`,
    );
    const image = await sharp(checker)
        .composite([{ input: actor }])
        .png()
        .toBuffer();
    const label = path.basename(input).replace(/\.(png|jpe?g|webp|avif)$/i, "");
    const safeLabel = label.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&apos;",
    })[character]);
    const svg = Buffer.from(
        `<svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#0f172a"/>
            <text x="14" y="25" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="15">${safeLabel}</text>
        </svg>`,
    );
    composites.push({ input: image, left, top });
    composites.push({ input: svg, left, top: top + tileHeight - labelHeight });
}

await mkdir(path.dirname(output), { recursive: true });
await sharp({
    create: {
        width: columns * tileWidth,
        height: rows * tileHeight,
        channels: 4,
        background: { r: 7, g: 11, b: 18, alpha: 1 },
    },
})
    .composite(composites)
    .png()
    .toFile(output);

console.log(output);
