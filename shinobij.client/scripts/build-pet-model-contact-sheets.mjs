import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const clientRoot = resolve(import.meta.dirname, "..");
const auditRoot = resolve(clientRoot, ".tmp/pet-model-certification");
const outputRoot = resolve(auditRoot, "contact-sheets");
const rarityOrder = { standard: 0, rare: 1, legendary: 2, mythic: 3 };

function rosterSort(left, right) {
    const [leftRarity, leftIndex] = left.split("-");
    const [rightRarity, rightIndex] = right.split("-");
    return rarityOrder[leftRarity] - rarityOrder[rightRarity] || Number(leftIndex) - Number(rightIndex);
}

async function buildSheets(sourceDirectory, prefix, sortFiles, suffix = "-sheet.png") {
    const files = (await readdir(sourceDirectory)).filter((file) => file.endsWith(suffix)).sort(sortFiles);
    if (!files.length) throw new Error(`${prefix}: no QA renders found in ${sourceDirectory}`);
    const cellWidth = 640;
    const cellHeight = 360;
    const columns = 4;
    const rows = 2;
    const perSheet = columns * rows;
    const outputs = [];
    for (let offset = 0; offset < files.length; offset += perSheet) {
        const pageFiles = files.slice(offset, offset + perSheet);
        const composites = await Promise.all(pageFiles.map(async (file, index) => ({
            input: await sharp(resolve(sourceDirectory, file)).resize(cellWidth, cellHeight, { fit: "fill" }).png().toBuffer(),
            left: (index % columns) * cellWidth,
            top: Math.floor(index / columns) * cellHeight,
        })));
        const output = resolve(outputRoot, `${prefix}-${String(offset / perSheet + 1).padStart(2, "0")}.png`);
        await sharp({
            create: {
                width: columns * cellWidth,
                height: rows * cellHeight,
                channels: 3,
                background: "#070b12",
            },
        }).composite(composites).png({ compressionLevel: 7 }).toFile(output);
        outputs.push(output);
    }
    return outputs;
}

await mkdir(outputRoot, { recursive: true });
const rosterAngles = await buildSheets(resolve(auditRoot, "four-angle"), "roster-angle", (left, right) => rosterSort(left.replace(/-sheet\.png$/u, ""), right.replace(/-sheet\.png$/u, "")));
const rosterMotions = await buildSheets(resolve(auditRoot, "motion-sheets"), "roster-motion", (left, right) => rosterSort(left.replace(/-motion\.png$/u, ""), right.replace(/-motion\.png$/u, "")), "-motion.png");
const starterAngles = await buildSheets(resolve(auditRoot, "starter-four-angle"), "starter-angle", (left, right) => left.localeCompare(right));
const starterMotions = await buildSheets(resolve(auditRoot, "starter-motion-sheets"), "starter-motion", (left, right) => left.localeCompare(right), "-motion.png");
console.log(
    `Built ${rosterAngles.length} roster-angle, ${rosterMotions.length} roster-motion, ${starterAngles.length} starter-angle, and ${starterMotions.length} starter-motion contact sheets in ${outputRoot}`,
);
