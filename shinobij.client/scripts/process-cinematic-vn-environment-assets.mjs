import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const pairs = process.argv.slice(2);

if (!pairs.length || pairs.includes("--help")) {
    console.log("Usage: node scripts/process-cinematic-vn-environment-assets.mjs <output.webp=source.png> [...]");
    process.exit(pairs.length ? 0 : 1);
}

for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0 || separator === pair.length - 1) {
        throw new Error(`Expected <output.webp=source.png>, received: ${pair}`);
    }

    const output = path.resolve(pair.slice(0, separator));
    const source = path.resolve(pair.slice(separator + 1));
    fs.mkdirSync(path.dirname(output), { recursive: true });

    const result = await sharp(source)
        .flatten({ background: "#071018" })
        .resize(1672, 941, {
            fit: "cover",
            position: "centre",
            kernel: sharp.kernel.lanczos3,
        })
        .webp({ quality: 90, smartSubsample: true, effort: 6 })
        .toFile(output);

    console.log(`${output} | ${result.width}x${result.height} | ${result.size} bytes`);
}
