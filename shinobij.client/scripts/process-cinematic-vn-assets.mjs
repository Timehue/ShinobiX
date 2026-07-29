import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const pairs = process.argv.slice(2);
if (!pairs.length || pairs.some((pair) => !pair.includes("="))) {
    console.error("Usage: node scripts/process-cinematic-vn-assets.mjs <output.webp=source.png> [...]");
    process.exit(1);
}

for (const pair of pairs) {
    const separator = pair.indexOf("=");
    const output = path.resolve(pair.slice(0, separator));
    const source = path.resolve(pair.slice(separator + 1));

    await mkdir(path.dirname(output), { recursive: true });
    const result = await sharp(source)
        .resize(1672, 941, { fit: "cover", position: "centre" })
        .webp({ quality: 88, effort: 6, smartSubsample: true })
        .toFile(output);

    console.log(`${output} | ${result.width}x${result.height} | ${result.size} bytes`);
}
