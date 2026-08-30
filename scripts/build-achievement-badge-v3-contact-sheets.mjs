import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ACHIEVEMENT_BADGE_ART_V3 } from "./achievement-badge-prompts-v3.mjs";

const root = process.cwd();
const sourceDir = path.join(root, "scripts", "badge-sources", "achievement-v3");
const outputDir = path.join(root, "scripts", "badge-sources", "achievement-v3-qa");
const columns = 7;
const rows = 2;
const imageSize = 160;
const labelHeight = 30;
const cellWidth = imageSize;
const cellHeight = imageSize + labelHeight;
const perSheet = columns * rows;

function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

async function buildSheet(items, sheetIndex) {
    const composites = [];
    for (let index = 0; index < items.length; index += 1) {
        const { id } = items[index];
        const column = index % columns;
        const row = Math.floor(index / columns);
        const left = column * cellWidth;
        const top = row * cellHeight;
        const image = await sharp(path.join(sourceDir, `${id}.png`))
            .resize(imageSize, imageSize, { fit: "cover", position: "attention" })
            .webp({ quality: 86 })
            .toBuffer();
        const label = Buffer.from(
            `<svg width="${cellWidth}" height="${labelHeight}">` +
            `<rect width="100%" height="100%" fill="#0b0c10"/>` +
            `<text x="8" y="19" fill="#f2e6c9" font-family="Segoe UI, sans-serif" font-size="12">${escapeXml(id)}</text>` +
            `</svg>`,
        );
        composites.push({ input: image, left, top });
        composites.push({ input: label, left, top: top + imageSize });
    }

    const sheetPath = path.join(outputDir, `achievement-v3-sheet-${sheetIndex + 1}.webp`);
    await sharp({
        create: {
            width: columns * cellWidth,
            height: rows * cellHeight,
            channels: 4,
            background: "#07080a",
        },
    })
        .composite(composites)
        .webp({ quality: 90, effort: 6 })
        .toFile(sheetPath);
    console.log(sheetPath);
}

async function main() {
    await mkdir(outputDir, { recursive: true });
    for (let offset = 0, sheetIndex = 0; offset < ACHIEVEMENT_BADGE_ART_V3.length; offset += perSheet, sheetIndex += 1) {
        await buildSheet(ACHIEVEMENT_BADGE_ART_V3.slice(offset, offset + perSheet), sheetIndex);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
