import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "src/assets/first-pact/citizen-atlas-source.png");
const outputDir = resolve(process.argv[3] ?? "src/assets/first-pact/portraits");
const portraits = [
    ["feed-merchant-rho", 0, 0],
    ["stable-hand-pell", 1, 0],
    ["court-courier-nemi", 0, 1],
    ["market-runner-yori", 1, 1],
];

await mkdir(outputDir, { recursive: true });
const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height || metadata.width !== metadata.height || metadata.width % 2 !== 0) {
    throw new Error(`Expected an even square four-cell atlas, received ${metadata.width ?? 0}x${metadata.height ?? 0}.`);
}
const cell = metadata.width / 2;

await Promise.all(portraits.map(async ([name, column, row]) => {
    const target = resolve(outputDir, `${name}.webp`);
    if (!target.startsWith(`${outputDir}\\`) && dirname(target) !== outputDir) throw new Error("Unsafe portrait target.");
    await sharp(source)
        .extract({ left: Number(column) * cell, top: Number(row) * cell, width: cell, height: cell })
        .resize(512, 512, { fit: "cover" })
        .webp({ quality: 88, smartSubsample: true })
        .toFile(target);
}));

await sharp(source)
    .resize(1024, 1024, { fit: "cover" })
    .webp({ quality: 86, smartSubsample: true })
    .toFile(resolve(dirname(outputDir), "sunken-court-citizen-atlas.webp"));
