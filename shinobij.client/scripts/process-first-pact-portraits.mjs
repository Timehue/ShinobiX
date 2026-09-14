import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "src/assets/first-pact/cast-atlas-source.png");
const outputDir = resolve(process.argv[3] ?? "src/assets/first-pact/portraits");
const portraits = [
    ["sena-vale", 0, 0],
    ["registrar-orin", 1, 0],
    ["scribe-vey", 2, 0],
    ["engineer-tam", 0, 1],
    ["bellwarden-isu", 1, 1],
    ["old-kaio", 2, 1],
];

await mkdir(outputDir, { recursive: true });
const metadata = await sharp(source).metadata();
if (metadata.width !== 1536 || metadata.height !== 1024) {
    throw new Error(`Expected a 1536x1024 six-cell atlas, received ${metadata.width}x${metadata.height}.`);
}

await Promise.all(portraits.map(async ([name, column, row]) => {
    const target = resolve(outputDir, `${name}.webp`);
    if (!target.startsWith(`${outputDir}\\`) && dirname(target) !== outputDir) throw new Error("Unsafe portrait target.");
    await sharp(source)
        .extract({ left: Number(column) * 512, top: Number(row) * 512, width: 512, height: 512 })
        .webp({ quality: 88, smartSubsample: true })
        .toFile(target);
}));

await sharp(source)
    .webp({ quality: 86, smartSubsample: true })
    .toFile(resolve(dirname(outputDir), "sunken-court-cast-atlas.webp"));
