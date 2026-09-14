import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const check = process.argv.includes("--check");
const assetDirectory = resolve("src/assets/first-pact");
const assets = [
    { name: "sunken-court-architecture-atlas", grid: true },
    { name: "sunken-court-street-props", grid: true },
    { name: "sunken-court-colosseum", square: true },
];

for (const asset of assets) {
    const source = resolve(assetDirectory, `${asset.name}-source.png`);
    const target = resolve(assetDirectory, `${asset.name}.webp`);
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`${asset.name} has no readable dimensions.`);
    if (asset.grid && (metadata.width % 4 !== 0 || metadata.height % 4 !== 0)) {
        throw new Error(`${asset.name} must remain a strict 4x4 grid; received ${metadata.width}x${metadata.height}.`);
    }
    if (asset.square && metadata.width !== metadata.height) {
        throw new Error(`${asset.name} must remain square; received ${metadata.width}x${metadata.height}.`);
    }

    const encoded = await sharp(source)
        .webp({ quality: 90, alphaQuality: 100, smartSubsample: true, effort: 6 })
        .toBuffer();
    if (check) {
        const current = await readFile(target);
        if (!current.equals(encoded)) throw new Error(`${asset.name}.webp is stale; run npm run author:first-pact-exteriors.`);
    } else {
        await writeFile(target, encoded);
    }
}

console.log(`${check ? "Verified" : "Authored"} ${assets.length} First Pact exterior assets.`);
