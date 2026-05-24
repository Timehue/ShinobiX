// Slice the 8 composite badge sheets into 60 individual /badges/<id>.png files.
//
// Setup:
//   1. npm install --save-dev sharp
//   2. Save the 8 composite images to scripts/badge-sources/ named sheet-01.png ... sheet-08.png
//      (file order must match the `sheets` config below).
//   3. node scripts/slice-badges.mjs
//
// Tweak `defaultRatios` or set per-sheet `ratios: {...}` overrides if any sheet
// crops slightly off (different AI render = different margins).

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCE_DIR = "scripts/badge-sources";
const OUTPUT_DIR = "shinobij.client/public/badges";
const OUTPUT_SIZE = 256;

// All values are fractions of the source image dimensions.
const defaultRatios = {
    titleTop: 0.11,          // top margin (skips the "Shinobi Journey Achievements" header)
    bottomPad: 0.02,         // bottom margin
    sidePad: 0.025,          // left/right margin
    iconHeightRatio: 0.72,   // keep this fraction of each cell vertically (drops the name banner)
    cellWidthUsage: 0.92,    // keep this fraction of each cell horizontally
    iconTopInsetRatio: 0.03, // small top inset within each cell
};

const sheets = [
    {
        name: "sheet-01",
        maxCols: 4,
        ratios: { iconHeightRatio: 0.66 },
        rows: [
            ["level-10", "level-40", "level-70", "level-100"],
            ["aura-1", "aura-150", "aura-300", "raid-25"],
            ["raid-250", "bloodline-equipped", "clan-founder", "clan-500"],
        ],
    },
    {
        name: "sheet-02",
        maxCols: 4,
        ratios: { iconHeightRatio: 0.58 },  // 2-row sheet → taller cells, clip more
        rows: [
            ["pve-first", "pve-100", "pve-500", "pve-2500"],
            ["pvp-first", "pvp-50", "pvp-250", "pvp-1000"],
        ],
    },
    {
        name: "sheet-03",
        maxCols: 4,
        ratios: { iconHeightRatio: 0.62 },
        rows: [
            ["ranked-first", "ranked-50", "ranked-1800", "ranked-2200"],
            ["mission-25", "mission-250", "mission-1000"],
        ],
    },
    {
        name: "sheet-04",
        maxCols: 3,
        ratios: { iconHeightRatio: 0.62 },
        rows: [
            ["explore-100", "explore-1000", "explore-5000"],
            ["tournament-3", "tower-25", "pet-100"],
        ],
    },
    {
        name: "sheet-05",
        maxCols: 4,
        ratios: { iconHeightRatio: 0.62 },
        rows: [
            ["ryo-25k", "ryo-500k", "ryo-5m", "honor-100"],
            ["honor-500", "fate-250", "fate-2500"],
        ],
    },
    {
        name: "sheet-06",
        maxCols: 4,
        ratios: { iconHeightRatio: 0.62 },
        rows: [
            ["secret-untouched", "secret-charms-100", "secret-stones-100", "secret-mythic-10"],
            ["secret-packrat", "secret-loadout-full", "secret-monthly-50"],
        ],
    },
    {
        name: "sheet-07",
        maxCols: 4,
        ratios: { iconHeightRatio: 0.62 },
        rows: [
            ["secret-hunter-5", "secret-titled", "secret-story-titled", "secret-bestiary-50"],
            ["secret-bestiary-200", "secret-elements-3", "secret-menagerie-5"],
        ],
    },
    {
        name: "sheet-08",
        maxCols: 3,
        ratios: { iconHeightRatio: 0.58 },
        rows: [
            ["secret-exams-3", "secret-war-vet-50", "secret-weekly-bosses-5"],
            ["secret-tile-cards-1000", "secret-minmaxer", "secret-war-crates-10"],
        ],
    },
];

async function sliceSheet(sheet) {
    const ratios = { ...defaultRatios, ...(sheet.ratios ?? {}) };
    const src = path.join(SOURCE_DIR, `${sheet.name}.png`);
    const meta = await sharp(src).metadata();
    const W = meta.width;
    const H = meta.height;

    const contentX = W * ratios.sidePad;
    const contentY = H * ratios.titleTop;
    const contentW = W - 2 * contentX;
    const contentH = H - contentY - H * ratios.bottomPad;
    const cellW = contentW / sheet.maxCols;
    const cellH = contentH / sheet.rows.length;

    let count = 0;
    for (let r = 0; r < sheet.rows.length; r++) {
        const row = sheet.rows[r];
        const rowStartX = contentX + ((sheet.maxCols - row.length) * cellW) / 2;
        for (let c = 0; c < row.length; c++) {
            const id = row[c];
            const cellX = rowStartX + c * cellW;
            const cellY = contentY + r * cellH;
            const iconSize = Math.min(cellH * ratios.iconHeightRatio, cellW * ratios.cellWidthUsage);
            const iconX = Math.round(cellX + (cellW - iconSize) / 2);
            const iconY = Math.round(cellY + cellH * ratios.iconTopInsetRatio);
            const size = Math.round(iconSize);
            await sharp(src)
                .extract({ left: iconX, top: iconY, width: size, height: size })
                .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
                .png()
                .toFile(path.join(OUTPUT_DIR, `${id}.png`));
            console.log(`  + ${id}.png`);
            count++;
        }
    }
    return count;
}

async function main() {
    await mkdir(OUTPUT_DIR, { recursive: true });
    let total = 0;
    for (const sheet of sheets) {
        console.log(`\n[${sheet.name}]`);
        try {
            total += await sliceSheet(sheet);
        } catch (err) {
            console.error(`  ! failed: ${err.message}`);
        }
    }
    console.log(`\nDone — wrote ${total} badges to ${OUTPUT_DIR}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
